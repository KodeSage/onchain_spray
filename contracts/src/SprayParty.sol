// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SprayParty
/// @notice Onchain money spraying. One party, thousands of tiny sprays.
/// @dev Designed backwards from a gas budget. On Monad the sender pays for the
///      gas *limit*, not gas used, so every gas unit here is money out of a
///      burner wallet that has to survive several hundred taps. Cold storage
///      access also costs 8,100 gas on Monad (vs 2,100 on Ethereum), which makes
///      the number of distinct slots touched in spray() the dominant cost.
///
///      Consequences, all deliberate:
///        - no dynamic arrays
///        - no string writes in the hot path (party names are bytes32)
///        - no external calls during spray (the host pulls funds later)
///        - the Party struct is ordered so the three fields spray() touches
///          (active, total, count) share a single storage slot
contract SprayParty {
    /// @dev Storage layout, and why:
    ///        slot 0 | host (20 bytes) + withdrawn (12 bytes)  -- exactly full
    ///        slot 1 | recipient (20 bytes)
    ///        slot 2 | name (bytes32)
    ///        slot 3 | active (1) + total (16) + count (8)      -- the hot slot
    ///      spray() reads and writes slot 3 and nothing else in this struct:
    ///      one cold SLOAD, one warm SSTORE. recipient deliberately lives in its
    ///      own slot outside the hot path, so adding it costs spray() nothing.
    struct Party {
        address host;
        uint96 withdrawn;
        address recipient;
        bytes32 name;
        bool active;
        uint128 total;
        uint64 count;
    }

    mapping(uint256 => Party) public parties;
    mapping(uint256 => mapping(address => uint256)) public sprayedBy;
    uint256 public partyCount;

    /// @notice The entire read API.
    /// @dev The stage view reconstructs the running total and the leaderboard
    ///      from these events alone — it never polls contract state. That is why
    ///      newTotal and count ride along in the payload: a client that has every
    ///      event has every number on screen, with zero extra reads.
    event Sprayed(
        uint256 indexed partyId,
        address indexed sprayer,
        uint256 amount,
        uint256 newTotal,
        uint64 count
    );

    event PartyCreated(
        uint256 indexed partyId,
        address indexed host,
        address indexed recipient,
        bytes32 name
    );
    event PartyEnded(uint256 indexed partyId, uint256 total);
    event PaidOut(uint256 indexed partyId, address indexed recipient, uint256 amount);

    error NotHost();
    error ZeroRecipient();
    error PartyInactive();
    error ZeroValue();
    error NothingToWithdraw();
    error TransferFailed();

    /// @notice Open a party.
    /// @param name  Display name, shown on both surfaces.
    /// @param recipient The person being sprayed. Every naira sprayed at this
    ///        party is payable to this address and to nobody else — not the
    ///        host, not the deployer. Set once, at creation, and immutable
    ///        after, so the room can see who they are spraying and be right.
    function createParty(bytes32 name, address recipient)
        external
        returns (uint256 partyId)
    {
        if (recipient == address(0)) revert ZeroRecipient();

        partyId = partyCount++;
        Party storage p = parties[partyId];
        p.host = msg.sender;
        p.recipient = recipient;
        p.name = name;
        p.active = true;
        emit PartyCreated(partyId, msg.sender, recipient, name);
    }

    /// @notice Spray. This is the hot path — everything else exists to serve it.
    function spray(uint256 partyId) external payable {
        if (msg.value == 0) revert ZeroValue();

        Party storage p = parties[partyId];
        if (!p.active) revert PartyInactive();

        // Funds accumulate in the contract. Forwarding to the host per spray
        // would cost ~9k extra gas and add reentrancy surface, on a function
        // called thousands of times a minute. The host withdraws later.
        // casting to 'uint128' is safe because uint128 holds 3.4e38 wei, which
        // is ~3.4e20 MON — more than the entire MON supply, let alone one party.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint128 newTotal = p.total + uint128(msg.value);
        uint64 newCount = p.count + 1;
        p.total = newTotal;
        p.count = newCount;

        sprayedBy[partyId][msg.sender] += msg.value;

        emit Sprayed(partyId, msg.sender, msg.value, newTotal, newCount);
    }

    /// @notice Push everything sprayed so far to the recipient.
    /// @dev Deliberately permissionless. The funds can only ever go to the
    ///      recipient fixed at creation, so letting anyone trigger the push
    ///      costs nothing and buys a lot: the stage calls this on a timer, and
    ///      the money lands in the dancer's wallet while the room is still
    ///      spraying, without the recipient needing gas or a wallet popup.
    ///
    ///      This is why spray() does not forward. A transfer inside spray()
    ///      would add a value-bearing CALL to a cold account on every single
    ///      tap — roughly 19,000 extra gas on Monad, a ~32% increase on a
    ///      function called thousands of times a minute, plus reentrancy
    ///      surface. Sweeping on a timer costs one transaction per sweep.
    function payout(uint256 partyId) external {
        Party storage p = parties[partyId];
        address recipient = p.recipient;
        if (recipient == address(0)) revert ZeroRecipient();

        uint256 available = uint256(p.total) - uint256(p.withdrawn);
        if (available == 0) revert NothingToWithdraw();

        // effects before interaction
        // casting to 'uint96' is safe because withdrawn can never exceed total,
        // and uint96 holds 7.9e28 wei (~79 billion MON). Sized at 96 bits so it
        // packs into the same slot as host, keeping it out of spray()'s slot.
        // forge-lint: disable-next-line(unsafe-typecast)
        p.withdrawn = uint96(uint256(p.withdrawn) + available);

        (bool ok, ) = recipient.call{value: available}("");
        if (!ok) revert TransferFailed();

        emit PaidOut(partyId, recipient, available);
    }

    function endParty(uint256 partyId) external {
        Party storage p = parties[partyId];
        if (msg.sender != p.host) revert NotHost();
        p.active = false;
        emit PartyEnded(partyId, p.total);
    }

    /// @notice Convenience read for tooling. Never called in the hot path.
    function partyInfo(uint256 partyId)
        external
        view
        returns (
            address host,
            address recipient,
            bytes32 name,
            bool active,
            uint256 total,
            uint64 count,
            uint256 pending
        )
    {
        Party storage p = parties[partyId];
        return (
            p.host,
            p.recipient,
            p.name,
            p.active,
            p.total,
            p.count,
            uint256(p.total) - uint256(p.withdrawn)
        );
    }
}
