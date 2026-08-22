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
    ///        slot 1 | name (bytes32)
    ///        slot 2 | active (1) + total (16) + count (8)      -- the hot slot
    ///      spray() reads and writes slot 2 and nothing else in this struct:
    ///      one cold SLOAD, one warm SSTORE.
    struct Party {
        address host;
        uint96 withdrawn;
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

    event PartyCreated(uint256 indexed partyId, address indexed host, bytes32 name);
    event PartyEnded(uint256 indexed partyId, uint256 total);
    event Withdrawn(uint256 indexed partyId, address indexed host, uint256 amount);

    error NotHost();
    error PartyInactive();
    error ZeroValue();
    error NothingToWithdraw();
    error TransferFailed();

    /// @notice Open a party. Returns its id.
    function createParty(bytes32 name) external returns (uint256 partyId) {
        partyId = partyCount++;
        Party storage p = parties[partyId];
        p.host = msg.sender;
        p.name = name;
        p.active = true;
        emit PartyCreated(partyId, msg.sender, name);
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

    /// @notice Host pulls accumulated funds. Not callable during the hot path.
    function withdraw(uint256 partyId) external {
        Party storage p = parties[partyId];
        if (msg.sender != p.host) revert NotHost();

        uint256 available = uint256(p.total) - uint256(p.withdrawn);
        if (available == 0) revert NothingToWithdraw();

        // effects before interaction
        // casting to 'uint96' is safe because withdrawn can never exceed total,
        // and uint96 holds 7.9e28 wei (~79 billion MON). Sized at 96 bits so it
        // packs into the same slot as host, keeping it out of spray()'s slot.
        // forge-lint: disable-next-line(unsafe-typecast)
        p.withdrawn = uint96(uint256(p.withdrawn) + available);

        (bool ok, ) = msg.sender.call{value: available}("");
        if (!ok) revert TransferFailed();

        emit Withdrawn(partyId, msg.sender, available);
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
        returns (address host, bytes32 name, bool active, uint256 total, uint64 count)
    {
        Party storage p = parties[partyId];
        return (p.host, p.name, p.active, p.total, p.count);
    }
}
