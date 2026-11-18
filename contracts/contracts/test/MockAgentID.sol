// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// Test double for the Agent ID contract: token id is keccak256(label), non transferable.
contract MockAgentID {
    mapping(uint256 => address) private _owner;

    function mint(string calldata label, address to) external {
        _owner[uint256(keccak256(bytes(label)))] = to;
    }

    function burn(string calldata label) external {
        delete _owner[uint256(keccak256(bytes(label)))];
    }

    function ownerOf(uint256 tokenId) external view returns (address) {
        address o = _owner[tokenId];
        require(o != address(0), "ERC721: invalid token ID");
        return o;
    }
}

/// A contract that refuses BNB, to prove payouts revert cleanly instead of losing funds.
