// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title TapArena
/// @notice A gamified testnet faucet. One global arena, daily rounds, and a
///         drip you have to earn by tapping.
/// @dev Designed backwards from two numbers: the gas a tap costs the house, and
///      the amount of parallelism Monad can actually give us.
///
///      On Monad the sender pays for the gas *limit*, not gas used, and every
///      tap is paid for by the house out of a burner it funded. Cold storage
///      access costs 8,100 gas (vs 2,100 on Ethereum), so the number of
///      distinct slots tap() touches is the dominant cost.
///
///      Consequences, all deliberate:
///        - the entire Player record is ONE packed slot, so tap() is one cold
///          SLOAD and one warm SSTORE and nothing else
///        - there is NO global counter. Monad executes optimistically in
///          parallel and re-executes on conflict; a shared totalTaps slot would
///          make every tap in the arena conflict with every other tap. The only
///          slot tap() touches belongs to the caller, so two players can never
///          conflict. Global numbers are rebuilt from events on the client.
///        - there is NO pause flag on tap(), for the same reason: reading one
///          would reintroduce exactly the shared cold slot we just designed
///          out. The arena is gated off-chain, at the operator.
///        - no dynamic arrays, no strings, no external calls in the hot path
contract TapArena {
    /// @dev Storage layout, and why:
    ///        round       (32)  | the round roundTaps belongs to
    ///        roundTaps   (32)  | taps this round — the leaderboard number
    ///        totalTaps   (64)  | lifetime taps, never reset
    ///        claimedRound(32)  | last round this player was settled for
    ///        claimedTotal(96)  | lifetime wei claimed
    ///      32+32+64+32+96 = 256 bits. Exactly one slot, deliberately.
    struct Player {
        uint32 round;
        uint32 roundTaps;
        uint64 totalTaps;
        uint32 claimedRound;
        uint96 claimedTotal;
    }

    mapping(address => Player) public players;

    address public owner;
    /// @notice The house server. Only address that can settle a claim.
    address public operator;

    /// @notice Most taps one transaction may claim credit for.
    /// @dev The client coalesces taps into tapBatch() when the daily budget is
    ///      tight. Capped so a scripted caller cannot mint a leaderboard in one
    ///      transaction — the cap is what keeps a batched tap honest.
    uint32 public constant MAX_BATCH = 64;

    /// @notice Taps required in a round before that round can be claimed.
    uint32 public constant MIN_TAPS_TO_CLAIM = 25;

    /// @notice Hard ceiling on a single settlement.
    /// @dev A rail against an operator bug, not against the operator. The house
    ///      wallet is hot and a mis-scaled amount is the realistic way to empty
    ///      it in one transaction. A faucet drip is never this large.
    uint256 public constant MAX_CLAIM = 5 ether;

    /// @notice The entire read API for the arena.
    /// @dev The client reconstructs the global total, the tx/sec wall and the
    ///      leaderboard from these events alone — it never polls contract
    ///      state. That is why roundTaps and totalTaps ride along in the
    ///      payload: a client that has every event has every number on screen,
    ///      at zero read cost. `round` is indexed so a cold load can pull just
    ///      today with one filtered getLogs instead of the whole history.
    event Tapped(
        address indexed player,
        uint32 indexed round,
        uint32 taps,
        uint32 roundTaps,
        uint64 totalTaps
    );

    event Claimed(
        address indexed player,
        address indexed payout,
        uint32 indexed round,
        uint256 amount,
        uint32 roundTaps
    );

    event OperatorChanged(address indexed operator);
    event OwnerChanged(address indexed owner);

    error NotOwner();
    error NotOperator();
    error ZeroAddress();
    error BadBatch();
    error AlreadyClaimed();
    error NotEnoughTaps();
    error WrongRound();
    error AmountMismatch();
    error ClaimTooLarge();
    error TransferFailed();

    constructor(address operator_) {
        owner = msg.sender;
        operator = operator_ == address(0) ? msg.sender : operator_;
        emit OwnerChanged(msg.sender);
        emit OperatorChanged(operator);
    }

    /* ---------------------------------------------------------------------
       Rounds
       --------------------------------------------------------------------- */

    /// @notice The current round. Rolls over daily at 00:00 UTC.
    /// @dev Derived from the clock rather than stored, so a round advances for
    ///      free: nobody pays gas to start one, and there is no shared "current
    ///      round" slot for taps to contend on.
    ///
    ///      The +1 is load-bearing. Rounds are 1-based so that round 0 can mean
    ///      "never" — a fresh Player has claimedRound == 0, and without the
    ///      offset that would read as "already claimed round 0" for anyone
    ///      testing against a zeroed block.timestamp.
    function currentRound() public view returns (uint32) {
        unchecked {
            return uint32(block.timestamp / 1 days) + 1;
        }
    }

    /* ---------------------------------------------------------------------
       The hot path
       --------------------------------------------------------------------- */

    /// @notice Tap once. This is the hot path — everything else serves it.
    function tap() external {
        _record(1);
    }

    /// @notice Credit several taps in one transaction.
    /// @dev Used when the day's gas budget is tight: the client coalesces taps
    ///      inside a short window and settles them together, which keeps the
    ///      arena playable on a fraction of the gas. Same score, same feel.
    function tapBatch(uint32 taps) external {
        if (taps == 0 || taps > MAX_BATCH) revert BadBatch();
        _record(taps);
    }

    /// @dev One cold SLOAD, one warm SSTORE, one log. Nothing else.
    function _record(uint32 taps) private {
        Player storage p = players[msg.sender];
        uint32 r = currentRound();

        unchecked {
            // A new round zeroes the round tally without any rollover
            // transaction ever having run.
            uint32 rt = p.round == r ? p.roundTaps + taps : taps;
            uint64 tt = p.totalTaps + taps;

            // uint32 roundTaps overflows at 4.29e9 taps in a single day and
            // uint64 totalTaps at 1.8e19; both are unreachable by a human or a
            // script that has to pay gas, so the checked-arithmetic guard is
            // pure cost in the hot path.
            p.round = r;
            p.roundTaps = rt;
            p.totalTaps = tt;

            emit Tapped(msg.sender, r, taps, rt, tt);
        }
    }

    /* ---------------------------------------------------------------------
       Claiming
       --------------------------------------------------------------------- */

    /// @notice Settle a player's drip for a round and forward it to `payout`.
    /// @dev Called by the house server after it has checked the things a
    ///      contract cannot see: a Turnstile token, per-IP and per-day caps in
    ///      Redis, and the remaining daily budget.
    ///
    ///      The split of trust is deliberate and is stated plainly in the
    ///      README: this contract is trustless about *eligibility* — it proves
    ///      the taps happened, in this round, and that nobody is paid twice —
    ///      and operator-trusted about the *amount*. Recording the claim on
    ///      chain is what makes double-claim prevention survive a Redis wipe,
    ///      and what makes the whole payout history publicly auditable.
    ///
    ///      The drip rides in as msg.value rather than from a pool the contract
    ///      holds, so there is no balance here to drain and no pool to top up.
    function settleClaim(address player, address payout, uint32 round, uint256 amount)
        external
        payable
    {
        if (msg.sender != operator) revert NotOperator();
        if (payout == address(0)) revert ZeroAddress();
        if (msg.value != amount) revert AmountMismatch();
        if (amount > MAX_CLAIM) revert ClaimTooLarge();

        Player storage p = players[player];
        if (p.claimedRound == round) revert AlreadyClaimed();
        if (p.round != round) revert WrongRound();

        uint32 rt = p.roundTaps;
        if (rt < MIN_TAPS_TO_CLAIM) revert NotEnoughTaps();

        // effects before interaction
        p.claimedRound = round;
        // safe: amount is bounded by MAX_CLAIM (5e18) above, and uint96 holds
        // 7.9e28 wei, so claimedTotal cannot overflow within any real lifetime.
        // forge-lint: disable-next-line(unsafe-typecast)
        p.claimedTotal = uint96(uint256(p.claimedTotal) + amount);

        (bool ok,) = payout.call{value: amount}("");
        if (!ok) revert TransferFailed();

        emit Claimed(player, payout, round, amount, rt);
    }

    /// @notice Whether `player` could be settled for the current round right now.
    /// @dev Read by the client to light up the claim button, and by the server
    ///      before it spends anything. Never called in the hot path.
    function claimable(address player)
        external
        view
        returns (bool ok, uint32 round, uint32 roundTaps, uint32 tapsNeeded)
    {
        Player storage p = players[player];
        round = currentRound();
        roundTaps = p.round == round ? p.roundTaps : 0;
        tapsNeeded = roundTaps >= MIN_TAPS_TO_CLAIM ? 0 : MIN_TAPS_TO_CLAIM - roundTaps;
        ok = tapsNeeded == 0 && p.claimedRound != round;
    }

    /* ---------------------------------------------------------------------
       Administration
       --------------------------------------------------------------------- */

    function setOperator(address operator_) external {
        if (msg.sender != owner) revert NotOwner();
        if (operator_ == address(0)) revert ZeroAddress();
        operator = operator_;
        emit OperatorChanged(operator_);
    }

    function transferOwnership(address owner_) external {
        if (msg.sender != owner) revert NotOwner();
        if (owner_ == address(0)) revert ZeroAddress();
        owner = owner_;
        emit OwnerChanged(owner_);
    }

    /// @notice Recover MON force-sent to this contract.
    /// @dev settleClaim forwards its own msg.value, so nothing should ever
    ///      accumulate here. selfdestruct and coinbase payments can still push
    ///      a balance in, and stranded testnet MON is testnet MON the faucet
    ///      cannot drip.
    function sweep(address to) external {
        if (msg.sender != owner) revert NotOwner();
        if (to == address(0)) revert ZeroAddress();
        (bool ok,) = to.call{value: address(this).balance}("");
        if (!ok) revert TransferFailed();
    }

    receive() external payable {}
}
