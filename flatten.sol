// Sources flattened with hardhat v2.26.1 https://hardhat.org

// SPDX-License-Identifier: BUSL-1.1 AND MIT

// File @openzeppelin/contracts/utils/Context.sol@v5.0.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.1) (utils/Context.sol)

pragma solidity ^0.8.20;

/**
 * @dev Provides information about the current execution context, including the
 * sender of the transaction and its data. While these are generally available
 * via msg.sender and msg.data, they should not be accessed in such a direct
 * manner, since when dealing with meta-transactions the account sending and
 * paying for execution may not be the actual sender (as far as an application
 * is concerned).
 *
 * This contract is only required for intermediate, library-like contracts.
 */
abstract contract Context {
    function _msgSender() internal view virtual returns (address) {
        return msg.sender;
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }

    function _contextSuffixLength() internal view virtual returns (uint256) {
        return 0;
    }
}


// File @openzeppelin/contracts/access/Ownable.sol@v5.0.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (access/Ownable.sol)

pragma solidity ^0.8.20;

/**
 * @dev Contract module which provides a basic access control mechanism, where
 * there is an account (an owner) that can be granted exclusive access to
 * specific functions.
 *
 * The initial owner is set to the address provided by the deployer. This can
 * later be changed with {transferOwnership}.
 *
 * This module is used through inheritance. It will make available the modifier
 * `onlyOwner`, which can be applied to your functions to restrict their use to
 * the owner.
 */
abstract contract Ownable is Context {
    address private _owner;

    /**
     * @dev The caller account is not authorized to perform an operation.
     */
    error OwnableUnauthorizedAccount(address account);

    /**
     * @dev The owner is not a valid owner account. (eg. `address(0)`)
     */
    error OwnableInvalidOwner(address owner);

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    /**
     * @dev Initializes the contract setting the address provided by the deployer as the initial owner.
     */
    constructor(address initialOwner) {
        if (initialOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(initialOwner);
    }

    /**
     * @dev Throws if called by any account other than the owner.
     */
    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    /**
     * @dev Returns the address of the current owner.
     */
    function owner() public view virtual returns (address) {
        return _owner;
    }

    /**
     * @dev Throws if the sender is not the owner.
     */
    function _checkOwner() internal view virtual {
        if (owner() != _msgSender()) {
            revert OwnableUnauthorizedAccount(_msgSender());
        }
    }

    /**
     * @dev Leaves the contract without owner. It will not be possible to call
     * `onlyOwner` functions. Can only be called by the current owner.
     *
     * NOTE: Renouncing ownership will leave the contract without an owner,
     * thereby disabling any functionality that is only available to the owner.
     */
    function renounceOwnership() public virtual onlyOwner {
        _transferOwnership(address(0));
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Can only be called by the current owner.
     */
    function transferOwnership(address newOwner) public virtual onlyOwner {
        if (newOwner == address(0)) {
            revert OwnableInvalidOwner(address(0));
        }
        _transferOwnership(newOwner);
    }

    /**
     * @dev Transfers ownership of the contract to a new account (`newOwner`).
     * Internal function without access restriction.
     */
    function _transferOwnership(address newOwner) internal virtual {
        address oldOwner = _owner;
        _owner = newOwner;
        emit OwnershipTransferred(oldOwner, newOwner);
    }
}


// File @openzeppelin/contracts/utils/introspection/IERC165.sol@v5.0.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (utils/introspection/IERC165.sol)

pragma solidity ^0.8.20;

/**
 * @dev Interface of the ERC165 standard, as defined in the
 * https://eips.ethereum.org/EIPS/eip-165[EIP].
 *
 * Implementers can declare support of contract interfaces, which can then be
 * queried by others ({ERC165Checker}).
 *
 * For an implementation, see {ERC165}.
 */
interface IERC165 {
    /**
     * @dev Returns true if this contract implements the interface defined by
     * `interfaceId`. See the corresponding
     * https://eips.ethereum.org/EIPS/eip-165#how-interfaces-are-identified[EIP section]
     * to learn more about how these ids are created.
     *
     * This function call must use less than 30 000 gas.
     */
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}


// File @openzeppelin/contracts/token/ERC1155/IERC1155.sol@v5.0.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.1) (token/ERC1155/IERC1155.sol)

pragma solidity ^0.8.20;

/**
 * @dev Required interface of an ERC1155 compliant contract, as defined in the
 * https://eips.ethereum.org/EIPS/eip-1155[EIP].
 */
interface IERC1155 is IERC165 {
    /**
     * @dev Emitted when `value` amount of tokens of type `id` are transferred from `from` to `to` by `operator`.
     */
    event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value);

    /**
     * @dev Equivalent to multiple {TransferSingle} events, where `operator`, `from` and `to` are the same for all
     * transfers.
     */
    event TransferBatch(
        address indexed operator,
        address indexed from,
        address indexed to,
        uint256[] ids,
        uint256[] values
    );

    /**
     * @dev Emitted when `account` grants or revokes permission to `operator` to transfer their tokens, according to
     * `approved`.
     */
    event ApprovalForAll(address indexed account, address indexed operator, bool approved);

    /**
     * @dev Emitted when the URI for token type `id` changes to `value`, if it is a non-programmatic URI.
     *
     * If an {URI} event was emitted for `id`, the standard
     * https://eips.ethereum.org/EIPS/eip-1155#metadata-extensions[guarantees] that `value` will equal the value
     * returned by {IERC1155MetadataURI-uri}.
     */
    event URI(string value, uint256 indexed id);

    /**
     * @dev Returns the value of tokens of token type `id` owned by `account`.
     *
     * Requirements:
     *
     * - `account` cannot be the zero address.
     */
    function balanceOf(address account, uint256 id) external view returns (uint256);

    /**
     * @dev xref:ROOT:erc1155.adoc#batch-operations[Batched] version of {balanceOf}.
     *
     * Requirements:
     *
     * - `accounts` and `ids` must have the same length.
     */
    function balanceOfBatch(
        address[] calldata accounts,
        uint256[] calldata ids
    ) external view returns (uint256[] memory);

    /**
     * @dev Grants or revokes permission to `operator` to transfer the caller's tokens, according to `approved`,
     *
     * Emits an {ApprovalForAll} event.
     *
     * Requirements:
     *
     * - `operator` cannot be the caller.
     */
    function setApprovalForAll(address operator, bool approved) external;

    /**
     * @dev Returns true if `operator` is approved to transfer ``account``'s tokens.
     *
     * See {setApprovalForAll}.
     */
    function isApprovedForAll(address account, address operator) external view returns (bool);

    /**
     * @dev Transfers a `value` amount of tokens of type `id` from `from` to `to`.
     *
     * WARNING: This function can potentially allow a reentrancy attack when transferring tokens
     * to an untrusted contract, when invoking {onERC1155Received} on the receiver.
     * Ensure to follow the checks-effects-interactions pattern and consider employing
     * reentrancy guards when interacting with untrusted contracts.
     *
     * Emits a {TransferSingle} event.
     *
     * Requirements:
     *
     * - `to` cannot be the zero address.
     * - If the caller is not `from`, it must have been approved to spend ``from``'s tokens via {setApprovalForAll}.
     * - `from` must have a balance of tokens of type `id` of at least `value` amount.
     * - If `to` refers to a smart contract, it must implement {IERC1155Receiver-onERC1155Received} and return the
     * acceptance magic value.
     */
    function safeTransferFrom(address from, address to, uint256 id, uint256 value, bytes calldata data) external;

    /**
     * @dev xref:ROOT:erc1155.adoc#batch-operations[Batched] version of {safeTransferFrom}.
     *
     * WARNING: This function can potentially allow a reentrancy attack when transferring tokens
     * to an untrusted contract, when invoking {onERC1155BatchReceived} on the receiver.
     * Ensure to follow the checks-effects-interactions pattern and consider employing
     * reentrancy guards when interacting with untrusted contracts.
     *
     * Emits either a {TransferSingle} or a {TransferBatch} event, depending on the length of the array arguments.
     *
     * Requirements:
     *
     * - `ids` and `values` must have the same length.
     * - If `to` refers to a smart contract, it must implement {IERC1155Receiver-onERC1155BatchReceived} and return the
     * acceptance magic value.
     */
    function safeBatchTransferFrom(
        address from,
        address to,
        uint256[] calldata ids,
        uint256[] calldata values,
        bytes calldata data
    ) external;
}


// File @openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol@v5.0.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (token/ERC20/extensions/IERC20Permit.sol)

pragma solidity ^0.8.20;

/**
 * @dev Interface of the ERC20 Permit extension allowing approvals to be made via signatures, as defined in
 * https://eips.ethereum.org/EIPS/eip-2612[EIP-2612].
 *
 * Adds the {permit} method, which can be used to change an account's ERC20 allowance (see {IERC20-allowance}) by
 * presenting a message signed by the account. By not relying on {IERC20-approve}, the token holder account doesn't
 * need to send a transaction, and thus is not required to hold Ether at all.
 *
 * ==== Security Considerations
 *
 * There are two important considerations concerning the use of `permit`. The first is that a valid permit signature
 * expresses an allowance, and it should not be assumed to convey additional meaning. In particular, it should not be
 * considered as an intention to spend the allowance in any specific way. The second is that because permits have
 * built-in replay protection and can be submitted by anyone, they can be frontrun. A protocol that uses permits should
 * take this into consideration and allow a `permit` call to fail. Combining these two aspects, a pattern that may be
 * generally recommended is:
 *
 * ```solidity
 * function doThingWithPermit(..., uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) public {
 *     try token.permit(msg.sender, address(this), value, deadline, v, r, s) {} catch {}
 *     doThing(..., value);
 * }
 *
 * function doThing(..., uint256 value) public {
 *     token.safeTransferFrom(msg.sender, address(this), value);
 *     ...
 * }
 * ```
 *
 * Observe that: 1) `msg.sender` is used as the owner, leaving no ambiguity as to the signer intent, and 2) the use of
 * `try/catch` allows the permit to fail and makes the code tolerant to frontrunning. (See also
 * {SafeERC20-safeTransferFrom}).
 *
 * Additionally, note that smart contract wallets (such as Argent or Safe) are not able to produce permit signatures, so
 * contracts should have entry points that don't rely on permit.
 */
interface IERC20Permit {
    /**
     * @dev Sets `value` as the allowance of `spender` over ``owner``'s tokens,
     * given ``owner``'s signed approval.
     *
     * IMPORTANT: The same issues {IERC20-approve} has related to transaction
     * ordering also apply here.
     *
     * Emits an {Approval} event.
     *
     * Requirements:
     *
     * - `spender` cannot be the zero address.
     * - `deadline` must be a timestamp in the future.
     * - `v`, `r` and `s` must be a valid `secp256k1` signature from `owner`
     * over the EIP712-formatted function arguments.
     * - the signature must use ``owner``'s current nonce (see {nonces}).
     *
     * For more information on the signature format, see the
     * https://eips.ethereum.org/EIPS/eip-2612#specification[relevant EIP
     * section].
     *
     * CAUTION: See Security Considerations above.
     */
    function permit(
        address owner,
        address spender,
        uint256 value,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;

    /**
     * @dev Returns the current nonce for `owner`. This value must be
     * included whenever a signature is generated for {permit}.
     *
     * Every successful call to {permit} increases ``owner``'s nonce by one. This
     * prevents a signature from being used multiple times.
     */
    function nonces(address owner) external view returns (uint256);

    /**
     * @dev Returns the domain separator used in the encoding of the signature for {permit}, as defined by {EIP712}.
     */
    // solhint-disable-next-line func-name-mixedcase
    function DOMAIN_SEPARATOR() external view returns (bytes32);
}


// File @openzeppelin/contracts/token/ERC20/IERC20.sol@v5.0.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (token/ERC20/IERC20.sol)

pragma solidity ^0.8.20;

/**
 * @dev Interface of the ERC20 standard as defined in the EIP.
 */
interface IERC20 {
    /**
     * @dev Emitted when `value` tokens are moved from one account (`from`) to
     * another (`to`).
     *
     * Note that `value` may be zero.
     */
    event Transfer(address indexed from, address indexed to, uint256 value);

    /**
     * @dev Emitted when the allowance of a `spender` for an `owner` is set by
     * a call to {approve}. `value` is the new allowance.
     */
    event Approval(address indexed owner, address indexed spender, uint256 value);

    /**
     * @dev Returns the value of tokens in existence.
     */
    function totalSupply() external view returns (uint256);

    /**
     * @dev Returns the value of tokens owned by `account`.
     */
    function balanceOf(address account) external view returns (uint256);

    /**
     * @dev Moves a `value` amount of tokens from the caller's account to `to`.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transfer(address to, uint256 value) external returns (bool);

    /**
     * @dev Returns the remaining number of tokens that `spender` will be
     * allowed to spend on behalf of `owner` through {transferFrom}. This is
     * zero by default.
     *
     * This value changes when {approve} or {transferFrom} are called.
     */
    function allowance(address owner, address spender) external view returns (uint256);

    /**
     * @dev Sets a `value` amount of tokens as the allowance of `spender` over the
     * caller's tokens.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * IMPORTANT: Beware that changing an allowance with this method brings the risk
     * that someone may use both the old and the new allowance by unfortunate
     * transaction ordering. One possible solution to mitigate this race
     * condition is to first reduce the spender's allowance to 0 and set the
     * desired value afterwards:
     * https://github.com/ethereum/EIPs/issues/20#issuecomment-263524729
     *
     * Emits an {Approval} event.
     */
    function approve(address spender, uint256 value) external returns (bool);

    /**
     * @dev Moves a `value` amount of tokens from `from` to `to` using the
     * allowance mechanism. `value` is then deducted from the caller's
     * allowance.
     *
     * Returns a boolean value indicating whether the operation succeeded.
     *
     * Emits a {Transfer} event.
     */
    function transferFrom(address from, address to, uint256 value) external returns (bool);
}


// File @openzeppelin/contracts/utils/Address.sol@v5.0.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (utils/Address.sol)

pragma solidity ^0.8.20;

/**
 * @dev Collection of functions related to the address type
 */
library Address {
    /**
     * @dev The ETH balance of the account is not enough to perform the operation.
     */
    error AddressInsufficientBalance(address account);

    /**
     * @dev There's no code at `target` (it is not a contract).
     */
    error AddressEmptyCode(address target);

    /**
     * @dev A call to an address target failed. The target may have reverted.
     */
    error FailedInnerCall();

    /**
     * @dev Replacement for Solidity's `transfer`: sends `amount` wei to
     * `recipient`, forwarding all available gas and reverting on errors.
     *
     * https://eips.ethereum.org/EIPS/eip-1884[EIP1884] increases the gas cost
     * of certain opcodes, possibly making contracts go over the 2300 gas limit
     * imposed by `transfer`, making them unable to receive funds via
     * `transfer`. {sendValue} removes this limitation.
     *
     * https://consensys.net/diligence/blog/2019/09/stop-using-soliditys-transfer-now/[Learn more].
     *
     * IMPORTANT: because control is transferred to `recipient`, care must be
     * taken to not create reentrancy vulnerabilities. Consider using
     * {ReentrancyGuard} or the
     * https://solidity.readthedocs.io/en/v0.8.20/security-considerations.html#use-the-checks-effects-interactions-pattern[checks-effects-interactions pattern].
     */
    function sendValue(address payable recipient, uint256 amount) internal {
        if (address(this).balance < amount) {
            revert AddressInsufficientBalance(address(this));
        }

        (bool success, ) = recipient.call{value: amount}("");
        if (!success) {
            revert FailedInnerCall();
        }
    }

    /**
     * @dev Performs a Solidity function call using a low level `call`. A
     * plain `call` is an unsafe replacement for a function call: use this
     * function instead.
     *
     * If `target` reverts with a revert reason or custom error, it is bubbled
     * up by this function (like regular Solidity function calls). However, if
     * the call reverted with no returned reason, this function reverts with a
     * {FailedInnerCall} error.
     *
     * Returns the raw returned data. To convert to the expected return value,
     * use https://solidity.readthedocs.io/en/latest/units-and-global-variables.html?highlight=abi.decode#abi-encoding-and-decoding-functions[`abi.decode`].
     *
     * Requirements:
     *
     * - `target` must be a contract.
     * - calling `target` with `data` must not revert.
     */
    function functionCall(address target, bytes memory data) internal returns (bytes memory) {
        return functionCallWithValue(target, data, 0);
    }

    /**
     * @dev Same as {xref-Address-functionCall-address-bytes-}[`functionCall`],
     * but also transferring `value` wei to `target`.
     *
     * Requirements:
     *
     * - the calling contract must have an ETH balance of at least `value`.
     * - the called Solidity function must be `payable`.
     */
    function functionCallWithValue(address target, bytes memory data, uint256 value) internal returns (bytes memory) {
        if (address(this).balance < value) {
            revert AddressInsufficientBalance(address(this));
        }
        (bool success, bytes memory returndata) = target.call{value: value}(data);
        return verifyCallResultFromTarget(target, success, returndata);
    }

    /**
     * @dev Same as {xref-Address-functionCall-address-bytes-}[`functionCall`],
     * but performing a static call.
     */
    function functionStaticCall(address target, bytes memory data) internal view returns (bytes memory) {
        (bool success, bytes memory returndata) = target.staticcall(data);
        return verifyCallResultFromTarget(target, success, returndata);
    }

    /**
     * @dev Same as {xref-Address-functionCall-address-bytes-}[`functionCall`],
     * but performing a delegate call.
     */
    function functionDelegateCall(address target, bytes memory data) internal returns (bytes memory) {
        (bool success, bytes memory returndata) = target.delegatecall(data);
        return verifyCallResultFromTarget(target, success, returndata);
    }

    /**
     * @dev Tool to verify that a low level call to smart-contract was successful, and reverts if the target
     * was not a contract or bubbling up the revert reason (falling back to {FailedInnerCall}) in case of an
     * unsuccessful call.
     */
    function verifyCallResultFromTarget(
        address target,
        bool success,
        bytes memory returndata
    ) internal view returns (bytes memory) {
        if (!success) {
            _revert(returndata);
        } else {
            // only check if target is a contract if the call was successful and the return data is empty
            // otherwise we already know that it was a contract
            if (returndata.length == 0 && target.code.length == 0) {
                revert AddressEmptyCode(target);
            }
            return returndata;
        }
    }

    /**
     * @dev Tool to verify that a low level call was successful, and reverts if it wasn't, either by bubbling the
     * revert reason or with a default {FailedInnerCall} error.
     */
    function verifyCallResult(bool success, bytes memory returndata) internal pure returns (bytes memory) {
        if (!success) {
            _revert(returndata);
        } else {
            return returndata;
        }
    }

    /**
     * @dev Reverts with returndata if present. Otherwise reverts with {FailedInnerCall}.
     */
    function _revert(bytes memory returndata) private pure {
        // Look for revert reason and bubble it up if present
        if (returndata.length > 0) {
            // The easiest way to bubble the revert reason is using memory via assembly
            /// @solidity memory-safe-assembly
            assembly {
                let returndata_size := mload(returndata)
                revert(add(32, returndata), returndata_size)
            }
        } else {
            revert FailedInnerCall();
        }
    }
}


// File @openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol@v5.0.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (token/ERC20/utils/SafeERC20.sol)

pragma solidity ^0.8.20;



/**
 * @title SafeERC20
 * @dev Wrappers around ERC20 operations that throw on failure (when the token
 * contract returns false). Tokens that return no value (and instead revert or
 * throw on failure) are also supported, non-reverting calls are assumed to be
 * successful.
 * To use this library you can add a `using SafeERC20 for IERC20;` statement to your contract,
 * which allows you to call the safe operations as `token.safeTransfer(...)`, etc.
 */
library SafeERC20 {
    using Address for address;

    /**
     * @dev An operation with an ERC20 token failed.
     */
    error SafeERC20FailedOperation(address token);

    /**
     * @dev Indicates a failed `decreaseAllowance` request.
     */
    error SafeERC20FailedDecreaseAllowance(address spender, uint256 currentAllowance, uint256 requestedDecrease);

    /**
     * @dev Transfer `value` amount of `token` from the calling contract to `to`. If `token` returns no value,
     * non-reverting calls are assumed to be successful.
     */
    function safeTransfer(IERC20 token, address to, uint256 value) internal {
        _callOptionalReturn(token, abi.encodeCall(token.transfer, (to, value)));
    }

    /**
     * @dev Transfer `value` amount of `token` from `from` to `to`, spending the approval given by `from` to the
     * calling contract. If `token` returns no value, non-reverting calls are assumed to be successful.
     */
    function safeTransferFrom(IERC20 token, address from, address to, uint256 value) internal {
        _callOptionalReturn(token, abi.encodeCall(token.transferFrom, (from, to, value)));
    }

    /**
     * @dev Increase the calling contract's allowance toward `spender` by `value`. If `token` returns no value,
     * non-reverting calls are assumed to be successful.
     */
    function safeIncreaseAllowance(IERC20 token, address spender, uint256 value) internal {
        uint256 oldAllowance = token.allowance(address(this), spender);
        forceApprove(token, spender, oldAllowance + value);
    }

    /**
     * @dev Decrease the calling contract's allowance toward `spender` by `requestedDecrease`. If `token` returns no
     * value, non-reverting calls are assumed to be successful.
     */
    function safeDecreaseAllowance(IERC20 token, address spender, uint256 requestedDecrease) internal {
        unchecked {
            uint256 currentAllowance = token.allowance(address(this), spender);
            if (currentAllowance < requestedDecrease) {
                revert SafeERC20FailedDecreaseAllowance(spender, currentAllowance, requestedDecrease);
            }
            forceApprove(token, spender, currentAllowance - requestedDecrease);
        }
    }

    /**
     * @dev Set the calling contract's allowance toward `spender` to `value`. If `token` returns no value,
     * non-reverting calls are assumed to be successful. Meant to be used with tokens that require the approval
     * to be set to zero before setting it to a non-zero value, such as USDT.
     */
    function forceApprove(IERC20 token, address spender, uint256 value) internal {
        bytes memory approvalCall = abi.encodeCall(token.approve, (spender, value));

        if (!_callOptionalReturnBool(token, approvalCall)) {
            _callOptionalReturn(token, abi.encodeCall(token.approve, (spender, 0)));
            _callOptionalReturn(token, approvalCall);
        }
    }

    /**
     * @dev Imitates a Solidity high-level call (i.e. a regular function call to a contract), relaxing the requirement
     * on the return value: the return value is optional (but if data is returned, it must not be false).
     * @param token The token targeted by the call.
     * @param data The call data (encoded using abi.encode or one of its variants).
     */
    function _callOptionalReturn(IERC20 token, bytes memory data) private {
        // We need to perform a low level call here, to bypass Solidity's return data size checking mechanism, since
        // we're implementing it ourselves. We use {Address-functionCall} to perform this call, which verifies that
        // the target address contains contract code and also asserts for success in the low-level call.

        bytes memory returndata = address(token).functionCall(data);
        if (returndata.length != 0 && !abi.decode(returndata, (bool))) {
            revert SafeERC20FailedOperation(address(token));
        }
    }

    /**
     * @dev Imitates a Solidity high-level call (i.e. a regular function call to a contract), relaxing the requirement
     * on the return value: the return value is optional (but if data is returned, it must not be false).
     * @param token The token targeted by the call.
     * @param data The call data (encoded using abi.encode or one of its variants).
     *
     * This is a variant of {_callOptionalReturn} that silents catches all reverts and returns a bool instead.
     */
    function _callOptionalReturnBool(IERC20 token, bytes memory data) private returns (bool) {
        // We need to perform a low level call here, to bypass Solidity's return data size checking mechanism, since
        // we're implementing it ourselves. We cannot use {Address-functionCall} here since this should return false
        // and not revert is the subcall reverts.

        (bool success, bytes memory returndata) = address(token).call(data);
        return success && (returndata.length == 0 || abi.decode(returndata, (bool))) && address(token).code.length > 0;
    }
}


// File @openzeppelin/contracts/utils/math/Math.sol@v5.0.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (utils/math/Math.sol)

pragma solidity ^0.8.20;

/**
 * @dev Standard math utilities missing in the Solidity language.
 */
library Math {
    /**
     * @dev Muldiv operation overflow.
     */
    error MathOverflowedMulDiv();

    enum Rounding {
        Floor, // Toward negative infinity
        Ceil, // Toward positive infinity
        Trunc, // Toward zero
        Expand // Away from zero
    }

    /**
     * @dev Returns the addition of two unsigned integers, with an overflow flag.
     */
    function tryAdd(uint256 a, uint256 b) internal pure returns (bool, uint256) {
        unchecked {
            uint256 c = a + b;
            if (c < a) return (false, 0);
            return (true, c);
        }
    }

    /**
     * @dev Returns the subtraction of two unsigned integers, with an overflow flag.
     */
    function trySub(uint256 a, uint256 b) internal pure returns (bool, uint256) {
        unchecked {
            if (b > a) return (false, 0);
            return (true, a - b);
        }
    }

    /**
     * @dev Returns the multiplication of two unsigned integers, with an overflow flag.
     */
    function tryMul(uint256 a, uint256 b) internal pure returns (bool, uint256) {
        unchecked {
            // Gas optimization: this is cheaper than requiring 'a' not being zero, but the
            // benefit is lost if 'b' is also tested.
            // See: https://github.com/OpenZeppelin/openzeppelin-contracts/pull/522
            if (a == 0) return (true, 0);
            uint256 c = a * b;
            if (c / a != b) return (false, 0);
            return (true, c);
        }
    }

    /**
     * @dev Returns the division of two unsigned integers, with a division by zero flag.
     */
    function tryDiv(uint256 a, uint256 b) internal pure returns (bool, uint256) {
        unchecked {
            if (b == 0) return (false, 0);
            return (true, a / b);
        }
    }

    /**
     * @dev Returns the remainder of dividing two unsigned integers, with a division by zero flag.
     */
    function tryMod(uint256 a, uint256 b) internal pure returns (bool, uint256) {
        unchecked {
            if (b == 0) return (false, 0);
            return (true, a % b);
        }
    }

    /**
     * @dev Returns the largest of two numbers.
     */
    function max(uint256 a, uint256 b) internal pure returns (uint256) {
        return a > b ? a : b;
    }

    /**
     * @dev Returns the smallest of two numbers.
     */
    function min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    /**
     * @dev Returns the average of two numbers. The result is rounded towards
     * zero.
     */
    function average(uint256 a, uint256 b) internal pure returns (uint256) {
        // (a + b) / 2 can overflow.
        return (a & b) + (a ^ b) / 2;
    }

    /**
     * @dev Returns the ceiling of the division of two numbers.
     *
     * This differs from standard division with `/` in that it rounds towards infinity instead
     * of rounding towards zero.
     */
    function ceilDiv(uint256 a, uint256 b) internal pure returns (uint256) {
        if (b == 0) {
            // Guarantee the same behavior as in a regular Solidity division.
            return a / b;
        }

        // (a + b - 1) / b can overflow on addition, so we distribute.
        return a == 0 ? 0 : (a - 1) / b + 1;
    }

    /**
     * @notice Calculates floor(x * y / denominator) with full precision. Throws if result overflows a uint256 or
     * denominator == 0.
     * @dev Original credit to Remco Bloemen under MIT license (https://xn--2-umb.com/21/muldiv) with further edits by
     * Uniswap Labs also under MIT license.
     */
    function mulDiv(uint256 x, uint256 y, uint256 denominator) internal pure returns (uint256 result) {
        unchecked {
            // 512-bit multiply [prod1 prod0] = x * y. Compute the product mod 2^256 and mod 2^256 - 1, then use
            // use the Chinese Remainder Theorem to reconstruct the 512 bit result. The result is stored in two 256
            // variables such that product = prod1 * 2^256 + prod0.
            uint256 prod0 = x * y; // Least significant 256 bits of the product
            uint256 prod1; // Most significant 256 bits of the product
            assembly {
                let mm := mulmod(x, y, not(0))
                prod1 := sub(sub(mm, prod0), lt(mm, prod0))
            }

            // Handle non-overflow cases, 256 by 256 division.
            if (prod1 == 0) {
                // Solidity will revert if denominator == 0, unlike the div opcode on its own.
                // The surrounding unchecked block does not change this fact.
                // See https://docs.soliditylang.org/en/latest/control-structures.html#checked-or-unchecked-arithmetic.
                return prod0 / denominator;
            }

            // Make sure the result is less than 2^256. Also prevents denominator == 0.
            if (denominator <= prod1) {
                revert MathOverflowedMulDiv();
            }

            ///////////////////////////////////////////////
            // 512 by 256 division.
            ///////////////////////////////////////////////

            // Make division exact by subtracting the remainder from [prod1 prod0].
            uint256 remainder;
            assembly {
                // Compute remainder using mulmod.
                remainder := mulmod(x, y, denominator)

                // Subtract 256 bit number from 512 bit number.
                prod1 := sub(prod1, gt(remainder, prod0))
                prod0 := sub(prod0, remainder)
            }

            // Factor powers of two out of denominator and compute largest power of two divisor of denominator.
            // Always >= 1. See https://cs.stackexchange.com/q/138556/92363.

            uint256 twos = denominator & (0 - denominator);
            assembly {
                // Divide denominator by twos.
                denominator := div(denominator, twos)

                // Divide [prod1 prod0] by twos.
                prod0 := div(prod0, twos)

                // Flip twos such that it is 2^256 / twos. If twos is zero, then it becomes one.
                twos := add(div(sub(0, twos), twos), 1)
            }

            // Shift in bits from prod1 into prod0.
            prod0 |= prod1 * twos;

            // Invert denominator mod 2^256. Now that denominator is an odd number, it has an inverse modulo 2^256 such
            // that denominator * inv = 1 mod 2^256. Compute the inverse by starting with a seed that is correct for
            // four bits. That is, denominator * inv = 1 mod 2^4.
            uint256 inverse = (3 * denominator) ^ 2;

            // Use the Newton-Raphson iteration to improve the precision. Thanks to Hensel's lifting lemma, this also
            // works in modular arithmetic, doubling the correct bits in each step.
            inverse *= 2 - denominator * inverse; // inverse mod 2^8
            inverse *= 2 - denominator * inverse; // inverse mod 2^16
            inverse *= 2 - denominator * inverse; // inverse mod 2^32
            inverse *= 2 - denominator * inverse; // inverse mod 2^64
            inverse *= 2 - denominator * inverse; // inverse mod 2^128
            inverse *= 2 - denominator * inverse; // inverse mod 2^256

            // Because the division is now exact we can divide by multiplying with the modular inverse of denominator.
            // This will give us the correct result modulo 2^256. Since the preconditions guarantee that the outcome is
            // less than 2^256, this is the final result. We don't need to compute the high bits of the result and prod1
            // is no longer required.
            result = prod0 * inverse;
            return result;
        }
    }

    /**
     * @notice Calculates x * y / denominator with full precision, following the selected rounding direction.
     */
    function mulDiv(uint256 x, uint256 y, uint256 denominator, Rounding rounding) internal pure returns (uint256) {
        uint256 result = mulDiv(x, y, denominator);
        if (unsignedRoundsUp(rounding) && mulmod(x, y, denominator) > 0) {
            result += 1;
        }
        return result;
    }

    /**
     * @dev Returns the square root of a number. If the number is not a perfect square, the value is rounded
     * towards zero.
     *
     * Inspired by Henry S. Warren, Jr.'s "Hacker's Delight" (Chapter 11).
     */
    function sqrt(uint256 a) internal pure returns (uint256) {
        if (a == 0) {
            return 0;
        }

        // For our first guess, we get the biggest power of 2 which is smaller than the square root of the target.
        //
        // We know that the "msb" (most significant bit) of our target number `a` is a power of 2 such that we have
        // `msb(a) <= a < 2*msb(a)`. This value can be written `msb(a)=2**k` with `k=log2(a)`.
        //
        // This can be rewritten `2**log2(a) <= a < 2**(log2(a) + 1)`
        // → `sqrt(2**k) <= sqrt(a) < sqrt(2**(k+1))`
        // → `2**(k/2) <= sqrt(a) < 2**((k+1)/2) <= 2**(k/2 + 1)`
        //
        // Consequently, `2**(log2(a) / 2)` is a good first approximation of `sqrt(a)` with at least 1 correct bit.
        uint256 result = 1 << (log2(a) >> 1);

        // At this point `result` is an estimation with one bit of precision. We know the true value is a uint128,
        // since it is the square root of a uint256. Newton's method converges quadratically (precision doubles at
        // every iteration). We thus need at most 7 iteration to turn our partial result with one bit of precision
        // into the expected uint128 result.
        unchecked {
            result = (result + a / result) >> 1;
            result = (result + a / result) >> 1;
            result = (result + a / result) >> 1;
            result = (result + a / result) >> 1;
            result = (result + a / result) >> 1;
            result = (result + a / result) >> 1;
            result = (result + a / result) >> 1;
            return min(result, a / result);
        }
    }

    /**
     * @notice Calculates sqrt(a), following the selected rounding direction.
     */
    function sqrt(uint256 a, Rounding rounding) internal pure returns (uint256) {
        unchecked {
            uint256 result = sqrt(a);
            return result + (unsignedRoundsUp(rounding) && result * result < a ? 1 : 0);
        }
    }

    /**
     * @dev Return the log in base 2 of a positive value rounded towards zero.
     * Returns 0 if given 0.
     */
    function log2(uint256 value) internal pure returns (uint256) {
        uint256 result = 0;
        unchecked {
            if (value >> 128 > 0) {
                value >>= 128;
                result += 128;
            }
            if (value >> 64 > 0) {
                value >>= 64;
                result += 64;
            }
            if (value >> 32 > 0) {
                value >>= 32;
                result += 32;
            }
            if (value >> 16 > 0) {
                value >>= 16;
                result += 16;
            }
            if (value >> 8 > 0) {
                value >>= 8;
                result += 8;
            }
            if (value >> 4 > 0) {
                value >>= 4;
                result += 4;
            }
            if (value >> 2 > 0) {
                value >>= 2;
                result += 2;
            }
            if (value >> 1 > 0) {
                result += 1;
            }
        }
        return result;
    }

    /**
     * @dev Return the log in base 2, following the selected rounding direction, of a positive value.
     * Returns 0 if given 0.
     */
    function log2(uint256 value, Rounding rounding) internal pure returns (uint256) {
        unchecked {
            uint256 result = log2(value);
            return result + (unsignedRoundsUp(rounding) && 1 << result < value ? 1 : 0);
        }
    }

    /**
     * @dev Return the log in base 10 of a positive value rounded towards zero.
     * Returns 0 if given 0.
     */
    function log10(uint256 value) internal pure returns (uint256) {
        uint256 result = 0;
        unchecked {
            if (value >= 10 ** 64) {
                value /= 10 ** 64;
                result += 64;
            }
            if (value >= 10 ** 32) {
                value /= 10 ** 32;
                result += 32;
            }
            if (value >= 10 ** 16) {
                value /= 10 ** 16;
                result += 16;
            }
            if (value >= 10 ** 8) {
                value /= 10 ** 8;
                result += 8;
            }
            if (value >= 10 ** 4) {
                value /= 10 ** 4;
                result += 4;
            }
            if (value >= 10 ** 2) {
                value /= 10 ** 2;
                result += 2;
            }
            if (value >= 10 ** 1) {
                result += 1;
            }
        }
        return result;
    }

    /**
     * @dev Return the log in base 10, following the selected rounding direction, of a positive value.
     * Returns 0 if given 0.
     */
    function log10(uint256 value, Rounding rounding) internal pure returns (uint256) {
        unchecked {
            uint256 result = log10(value);
            return result + (unsignedRoundsUp(rounding) && 10 ** result < value ? 1 : 0);
        }
    }

    /**
     * @dev Return the log in base 256 of a positive value rounded towards zero.
     * Returns 0 if given 0.
     *
     * Adding one to the result gives the number of pairs of hex symbols needed to represent `value` as a hex string.
     */
    function log256(uint256 value) internal pure returns (uint256) {
        uint256 result = 0;
        unchecked {
            if (value >> 128 > 0) {
                value >>= 128;
                result += 16;
            }
            if (value >> 64 > 0) {
                value >>= 64;
                result += 8;
            }
            if (value >> 32 > 0) {
                value >>= 32;
                result += 4;
            }
            if (value >> 16 > 0) {
                value >>= 16;
                result += 2;
            }
            if (value >> 8 > 0) {
                result += 1;
            }
        }
        return result;
    }

    /**
     * @dev Return the log in base 256, following the selected rounding direction, of a positive value.
     * Returns 0 if given 0.
     */
    function log256(uint256 value, Rounding rounding) internal pure returns (uint256) {
        unchecked {
            uint256 result = log256(value);
            return result + (unsignedRoundsUp(rounding) && 1 << (result << 3) < value ? 1 : 0);
        }
    }

    /**
     * @dev Returns whether a provided rounding mode is considered rounding up for unsigned integers.
     */
    function unsignedRoundsUp(Rounding rounding) internal pure returns (bool) {
        return uint8(rounding) % 2 == 1;
    }
}


// File @openzeppelin/contracts/utils/ReentrancyGuard.sol@v5.0.1

// Original license: SPDX_License_Identifier: MIT
// OpenZeppelin Contracts (last updated v5.0.0) (utils/ReentrancyGuard.sol)

pragma solidity ^0.8.20;

/**
 * @dev Contract module that helps prevent reentrant calls to a function.
 *
 * Inheriting from `ReentrancyGuard` will make the {nonReentrant} modifier
 * available, which can be applied to functions to make sure there are no nested
 * (reentrant) calls to them.
 *
 * Note that because there is a single `nonReentrant` guard, functions marked as
 * `nonReentrant` may not call one another. This can be worked around by making
 * those functions `private`, and then adding `external` `nonReentrant` entry
 * points to them.
 *
 * TIP: If you would like to learn more about reentrancy and alternative ways
 * to protect against it, check out our blog post
 * https://blog.openzeppelin.com/reentrancy-after-istanbul/[Reentrancy After Istanbul].
 */
abstract contract ReentrancyGuard {
    // Booleans are more expensive than uint256 or any type that takes up a full
    // word because each write operation emits an extra SLOAD to first read the
    // slot's contents, replace the bits taken up by the boolean, and then write
    // back. This is the compiler's defense against contract upgrades and
    // pointer aliasing, and it cannot be disabled.

    // The values being non-zero value makes deployment a bit more expensive,
    // but in exchange the refund on every call to nonReentrant will be lower in
    // amount. Since refunds are capped to a percentage of the total
    // transaction's gas, it is best to keep them low in cases like this one, to
    // increase the likelihood of the full refund coming into effect.
    uint256 private constant NOT_ENTERED = 1;
    uint256 private constant ENTERED = 2;

    uint256 private _status;

    /**
     * @dev Unauthorized reentrant call.
     */
    error ReentrancyGuardReentrantCall();

    constructor() {
        _status = NOT_ENTERED;
    }

    /**
     * @dev Prevents a contract from calling itself, directly or indirectly.
     * Calling a `nonReentrant` function from another `nonReentrant`
     * function is not supported. It is possible to prevent this from happening
     * by making the `nonReentrant` function external, and making it call a
     * `private` function that does the actual work.
     */
    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    function _nonReentrantBefore() private {
        // On the first call to nonReentrant, _status will be NOT_ENTERED
        if (_status == ENTERED) {
            revert ReentrancyGuardReentrantCall();
        }

        // Any calls to nonReentrant after this point will fail
        _status = ENTERED;
    }

    function _nonReentrantAfter() private {
        // By storing the original value once again, a refund is triggered (see
        // https://eips.ethereum.org/EIPS/eip-2200)
        _status = NOT_ENTERED;
    }

    /**
     * @dev Returns true if the reentrancy guard is currently set to "entered", which indicates there is a
     * `nonReentrant` function in the call stack.
     */
    function _reentrancyGuardEntered() internal view returns (bool) {
        return _status == ENTERED;
    }
}


// File contracts/interfaces/MCV2_ICommonToken.sol

// Original license: SPDX_License_Identifier: BUSL-1.1

pragma solidity ^0.8.20;

interface MCV2_ICommonToken {
    function totalSupply() external view returns (uint256);

    function mintByBond(address to, uint256 amount) external;

    function burnByBond(address account, uint256 amount) external;

    function decimals() external pure returns (uint8);

    function name() external view returns (string memory);

    function symbol() external view returns (string memory);
}


// File contracts/Stake.sol

// Original license: SPDX_License_Identifier: BUSL-1.1

/**
 * @title Stake Contract
 * @notice Mint Club V2 - Staking Contract
 * @dev Allows users to create staking pools for any ERC20 tokens with timestamp-based reward distribution
 *
 * NOTICES:
 *      1. We use timestamp-based reward calculation,
 *         so it inherently carries minimal risk of timestamp manipulation (±15 seconds).
 *         We chose this design because this contract may be deployed on various networks with differing block times,
 *         and block times may change in the future even on the same network.
 *      2. We use uint40 for timestamp storage, which supports up to year 36,812.
 *      3. Precision Loss: Due to integer division in reward calculations, small amounts
 *         of reward tokens may be lost as "dust" and remain in the contract permanently.
 *         This is most pronounced with small reward amounts relative to large staking amounts.
 */

pragma solidity =0.8.30;







contract Stake is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // MARK: - Constants & Errors

    uint256 private constant MAX_CLAIM_FEE = 2000; // 20% - for safety when admin privileges are abused
    uint256 private constant REWARD_PRECISION = 1e18;
    uint256 public constant MIN_REWARD_DURATION = 3600; // 1 hour in seconds
    uint256 public constant MAX_REWARD_DURATION =
        MIN_REWARD_DURATION * 24 * 365 * 10; // 10 years

    // Gas stipend for external view calls to prevent DoS attacks on view functions
    // 20000 gas handles very long token names/symbols (~256 chars) while preventing DoS
    uint256 private constant METADATA_GAS_STIPEND = 20000;
    uint256 private constant MAX_ITEMS_PER_PAGE = 500;

    // MARK: - Error messages

    error Stake__InvalidToken();
    error Stake__TokenHasTransferFeesOrRebasing();
    error Stake__InvalidCreationFee();
    error Stake__FeeTransferFailed();
    error Stake__InvalidDuration();
    error Stake__PoolNotFound();
    error Stake__PoolCancelled();
    error Stake__PoolFinished();
    error Stake__InsufficientBalance();
    error Stake__InvalidPaginationParameters();
    error Stake__Unauthorized();
    error Stake__InvalidAddress();
    error Stake__ZeroAmount();
    error Stake__InvalidClaimFee();
    error Stake__StakeAmountTooLarge();
    error Stake__InvalidTokenId();
    error Stake__RewardRateTooLow();
    error Stake__InvalidRewardStartsAt();
    error Stake__InvalidTokenType();

    // MARK: - Structs

    // Gas optimized struct packing - fits in 7 storage slots
    struct Pool {
        address stakingToken; // 160 bits - slot 0 - immutable
        bool isStakingTokenERC20; // 8 bit - slot 0 - immutable
        address rewardToken; // 160 bits - slot 1 - immutable
        address creator; // 160 bits - slot 2 - immutable
        uint104 rewardAmount; // 104 bits - slot 3 - immutable
        uint32 rewardDuration; // 32 bits - slot 3 (up to ~136 years in seconds) - immutable
        uint40 rewardStartsAt; // 40 bits - slot 3 - immutable (0 for immediate start on the first stake, future time up to 1 week from now to allow pre-staking)
        uint40 rewardStartedAt; // 40 bits - slot 3 (until year 36,812) - 0 until first stake
        uint40 cancelledAt; // 40 bits - slot 3 - default 0 (not cancelled)
        uint128 totalStaked; // 128 bits - slot 4
        uint32 activeStakerCount; // 32 bits - slot 4 - number of unique active stakers
        uint40 lastRewardUpdatedAt; // 40 bits - slot 4
        uint256 accRewardPerShare; // 256 bits - slot 5
        uint104 totalAllocatedRewards; // 104 bits - slot 6 - Track rewards allocated to users (earned but maybe not claimed)
    }

    // Gas optimized struct packing - fits in 3 storage slots
    struct UserStake {
        uint104 stakedAmount; // 104 bits - slot 0
        uint104 claimedTotal; // 104 bits - slot 0 - informational
        uint104 feeTotal; // 104 bits - slot 1 - informational
        uint256 rewardDebt; // 256 bits - slot 2 - uses full slot for overflow safety
    }

    // MARK: - Protocol Config Variables

    address public protocolBeneficiary;
    uint256 public creationFee;
    uint256 public claimFee; // BP: 10000 = 100%

    // MARK: - Pool State Variables

    uint256 public poolCount;
    // poolId => Pool
    mapping(uint256 => Pool) public pools;
    // user => poolId => UserStake
    mapping(address => mapping(uint256 => UserStake)) public userPoolStake;

    // MARK: - Events

    event PoolCreated(
        uint256 poolId,
        address indexed creator,
        address indexed stakingToken,
        bool isStakingTokenERC20,
        address indexed rewardToken,
        uint104 rewardAmount,
        uint40 rewardStartsAt,
        uint32 rewardDuration
    );
    event Staked(
        uint256 indexed poolId,
        address indexed staker,
        uint104 indexed amount
    );
    event Unstaked(
        uint256 indexed poolId,
        address indexed staker,
        uint104 indexed amount,
        bool rewardClaimed
    );
    event RewardClaimed(
        uint256 indexed poolId,
        address indexed staker,
        uint104 indexed reward,
        uint104 fee
    );
    event PoolCancelled(
        uint256 indexed poolId,
        uint256 indexed leftoverRewards
    );
    event ProtocolBeneficiaryUpdated(
        address oldBeneficiary,
        address newBeneficiary
    );
    event CreationFeeUpdated(uint256 oldFee, uint256 newFee);
    event ClaimFeeUpdated(uint256 oldFee, uint256 newFee);

    constructor(
        address protocolBeneficiary_,
        uint256 creationFee_,
        uint256 claimFee_
    ) Ownable(msg.sender) {
        updateProtocolBeneficiary(protocolBeneficiary_);
        updateCreationFee(creationFee_);
        updateClaimFee(claimFee_);
    }

    // MARK: - Modifiers

    modifier _checkPoolExists(uint256 poolId) {
        if (poolId >= poolCount) revert Stake__PoolNotFound();
        _;
    }

    // MARK: - Internal Helper Functions

    /**
     * @dev Calculates up-to-date accRewardPerShare for a pool without modifying state
     * @param pool The pool struct
     * @return updatedAccRewardPerShare The up-to-date accumulated reward per share
     * @notice Integer division may cause precision loss in reward calculations
     */
    function _getUpdatedAccRewardPerShare(
        Pool memory pool
    ) internal view returns (uint256 updatedAccRewardPerShare) {
        uint40 currentTime = uint40(block.timestamp);

        // If rewards haven't started yet or no staked, no rewards to distribute
        if (
            pool.rewardStartedAt == 0 ||
            pool.totalStaked == 0 ||
            currentTime <= pool.lastRewardUpdatedAt
        ) return pool.accRewardPerShare;

        uint256 endTime = pool.rewardStartedAt + pool.rewardDuration;
        // If pool is cancelled, use cancellation time as end time
        if (pool.cancelledAt > 0 && pool.cancelledAt < endTime)
            endTime = pool.cancelledAt;

        uint256 toTime = currentTime > endTime ? endTime : currentTime;
        uint256 timePassed = toTime - pool.lastRewardUpdatedAt;

        if (timePassed == 0) return pool.accRewardPerShare;

        uint256 totalReward = Math.mulDiv(
            timePassed,
            pool.rewardAmount,
            pool.rewardDuration
        );

        return
            pool.accRewardPerShare +
            Math.mulDiv(totalReward, REWARD_PRECISION, pool.totalStaked);
    }

    /**
     * @dev Calculates claimable rewards (assumes pool is updated)
     * @param updatedAccRewardPerShare The accumulated reward per share
     * @param stakedAmount The amount of tokens staked
     * @param originalRewardDebt The baseline reward amount to subtract, accounting for staking timing and already claimed rewards
     * @return rewardClaimable The amount of rewards that can be claimed
     * @notice Due to integer division, small amounts of rewards may be lost as "dust"
     *         This precision loss is most significant with small reward amounts relative to large total staked amounts
     */
    function _claimableReward(
        uint256 updatedAccRewardPerShare,
        uint256 stakedAmount,
        uint256 originalRewardDebt
    ) internal view returns (uint256 rewardClaimable, uint256 fee) {
        if (stakedAmount == 0) return (0, 0);

        uint256 accRewardAmount = Math.mulDiv(
            stakedAmount,
            updatedAccRewardPerShare,
            REWARD_PRECISION
        );

        if (accRewardAmount <= originalRewardDebt) return (0, 0);

        rewardClaimable = accRewardAmount - originalRewardDebt;
        fee = Math.mulDiv(rewardClaimable, claimFee, 10000);
        rewardClaimable -= fee;
    }

    /**
     * @dev Internal function to claim rewards for a user
     * @param poolId The ID of the pool
     * @param user The address of the user
     */
    function _claimRewards(uint256 poolId, address user) internal {
        Pool storage pool = pools[poolId];
        UserStake storage userStake = userPoolStake[user][poolId];

        // Use the helper function to calculate claimable rewards
        (uint256 claimAmount, uint256 fee) = _claimableReward(
            pool.accRewardPerShare,
            userStake.stakedAmount,
            userStake.rewardDebt
        );

        uint256 rewardAndFee = claimAmount + fee;
        assert(rewardAndFee <= pool.rewardAmount);
        if (rewardAndFee == 0) return;

        // Update user's reward debt and claimed rewards
        userStake.rewardDebt += rewardAndFee;
        // Safe to cast because claimAmount + fee <= pool.rewardAmount (uint104)
        userStake.claimedTotal += uint104(claimAmount);
        userStake.feeTotal += uint104(fee);

        // Transfer reward tokens to user (reward tokens are always ERC20)
        if (claimAmount > 0) {
            IERC20(pool.rewardToken).safeTransfer(user, claimAmount);
        }
        if (fee > 0) {
            IERC20(pool.rewardToken).safeTransfer(protocolBeneficiary, fee);
        }

        emit RewardClaimed(poolId, user, uint104(claimAmount), uint104(fee));
    }

    /**
     * @dev Safely transfers tokens from one address to another with balance verification
     * @param token The address of the token to transfer
     * @param isERC20 Whether the token is ERC20 (true) or ERC1155 (false)
     * @param from The address to transfer from
     * @param to The address to transfer to
     * @param amount The amount to transfer
     */
    function _safeTransferFrom(
        address token,
        bool isERC20,
        address from,
        address to,
        uint256 amount
    ) internal {
        if (isERC20) {
            uint256 balanceBefore = IERC20(token).balanceOf(to);
            IERC20(token).safeTransferFrom(from, to, amount);
            uint256 balanceAfter = IERC20(token).balanceOf(to);

            if (balanceAfter - balanceBefore != amount) {
                revert Stake__TokenHasTransferFeesOrRebasing();
            }
        } else {
            // For ERC1155, we use token ID 0 only
            uint256 balanceBefore = IERC1155(token).balanceOf(to, 0);
            IERC1155(token).safeTransferFrom(from, to, 0, amount, "");
            uint256 balanceAfter = IERC1155(token).balanceOf(to, 0);

            if (balanceAfter - balanceBefore != amount) {
                revert Stake__TokenHasTransferFeesOrRebasing();
            }
        }
    }

    /**
     * @dev Updates the reward variables for a pool based on timestamp
     * @param poolId The ID of the pool to update
     */
    function _updatePool(uint256 poolId) internal {
        Pool storage pool = pools[poolId];
        uint40 currentTime = uint40(block.timestamp);

        // Cache frequently accessed storage values
        uint40 rewardStartedAt = pool.rewardStartedAt;
        uint40 lastRewardUpdatedAt = pool.lastRewardUpdatedAt;

        // If rewards haven't started yet or no time passed, no need to update
        if (rewardStartedAt == 0 || currentTime <= lastRewardUpdatedAt) return;

        // Cache more values for efficiency
        uint32 rewardDuration = pool.rewardDuration;
        uint40 cancelledAt = pool.cancelledAt;
        uint256 endTime = rewardStartedAt + rewardDuration;

        // If pool is cancelled, use cancellation time as end time
        if (cancelledAt > 0 && cancelledAt < endTime) {
            endTime = cancelledAt;
        }
        uint256 toTime = currentTime > endTime ? endTime : currentTime;
        uint256 timePassed = toTime - lastRewardUpdatedAt;

        // Track allocated rewards if there are stakers and time has passed
        if (pool.totalStaked > 0 && timePassed > 0) {
            uint256 totalReward = Math.mulDiv(
                timePassed,
                pool.rewardAmount,
                pool.rewardDuration
            );
            // Track these rewards as allocated to users (earned, whether claimed or not)
            pool.totalAllocatedRewards += uint104(totalReward);
        }

        // Update accRewardPerShare
        pool.accRewardPerShare = _getUpdatedAccRewardPerShare(pool);

        pool.lastRewardUpdatedAt = uint40(toTime);
    }

    /**
     * @dev Checks if the token is a valid ERC20 or ERC1155 token
     * @param token The address of the token to check
     * @param isERC20 Whether the token is ERC20 (true) or ERC1155 (false)
     * @return isValid True if the token is valid, false otherwise
     */
    function _isTokenTypeValid(
        address token,
        bool isERC20
    ) internal view returns (bool) {
        if (isERC20) {
            // 1) IERC1155 interface claiming contract is rejected
            (bool ok165, bytes memory ret165) = token.staticcall{
                gas: METADATA_GAS_STIPEND
            }(
                abi.encodeWithSignature(
                    "supportsInterface(bytes4)",
                    bytes4(0xd9b67a26) // ERC1155 interface id
                )
            );
            if (ok165 && ret165.length == 32 && abi.decode(ret165, (bool))) {
                return false;
            }

            // 2) ERC20 balanceOf(address) exists and returns 32 bytes
            (bool ok20, bytes memory ret20) = token.staticcall{
                gas: METADATA_GAS_STIPEND
            }(abi.encodeWithSignature("balanceOf(address)", address(this)));
            if (!ok20 || ret20.length != 32) {
                return false;
            }
        } else {
            // Check if the token is an ERC1155 (balanceOf(address,uint256))
            (bool ok1155, bytes memory ret1155) = token.staticcall{
                gas: METADATA_GAS_STIPEND
            }(
                abi.encodeWithSignature(
                    "balanceOf(address,uint256)",
                    address(this),
                    uint256(0)
                )
            );
            if (!ok1155 || ret1155.length != 32) {
                return false;
            }
        }

        return true;
    }

    // MARK: - Pool Management

    /**
     * @dev Creates a new staking pool with timestamp-based rewards
     * @param stakingToken The address of the token to be staked
     * @param rewardToken The address of the reward token
     * @param rewardAmount The total amount of rewards to be distributed
     * @param rewardStartsAt The timestamp when rewards should start (max 1 week from now)
     * @param rewardDuration The duration in seconds over which rewards are distributed
     * @return poolId The ID of the newly created pool
     */
    function createPool(
        address stakingToken,
        bool isStakingTokenERC20,
        address rewardToken,
        uint104 rewardAmount,
        uint40 rewardStartsAt,
        uint32 rewardDuration
    ) external payable nonReentrant returns (uint256 poolId) {
        if (stakingToken == address(0)) revert Stake__InvalidToken();
        if (rewardToken == address(0)) revert Stake__InvalidToken();
        if (rewardAmount == 0) revert Stake__ZeroAmount();
        if (
            rewardDuration < MIN_REWARD_DURATION ||
            rewardDuration > MAX_REWARD_DURATION
        ) revert Stake__InvalidDuration();
        // Validate that reward rate is meaningful to prevent precision loss
        if (rewardAmount / rewardDuration == 0)
            revert Stake__RewardRateTooLow();
        if (rewardStartsAt > block.timestamp + 7 days)
            revert Stake__InvalidRewardStartsAt();
        if (msg.value != creationFee) revert Stake__InvalidCreationFee();
        if (creationFee > 0) {
            (bool success, ) = protocolBeneficiary.call{value: creationFee}("");
            if (!success) revert Stake__FeeTransferFailed();
        }
        if (!_isTokenTypeValid(stakingToken, isStakingTokenERC20))
            revert Stake__InvalidTokenType();

        poolId = poolCount;
        poolCount = poolId + 1;

        pools[poolId] = Pool({
            stakingToken: stakingToken,
            isStakingTokenERC20: isStakingTokenERC20,
            rewardToken: rewardToken,
            creator: msg.sender,
            rewardAmount: rewardAmount,
            rewardDuration: rewardDuration,
            rewardStartsAt: rewardStartsAt,
            rewardStartedAt: 0,
            cancelledAt: 0,
            totalStaked: 0,
            activeStakerCount: 0,
            lastRewardUpdatedAt: 0,
            accRewardPerShare: 0,
            totalAllocatedRewards: 0
        });

        // Transfer reward tokens from creator to contract (always ERC20)
        _safeTransferFrom(
            rewardToken,
            true,
            msg.sender,
            address(this),
            rewardAmount
        );

        emit PoolCreated(
            poolId,
            msg.sender,
            stakingToken,
            isStakingTokenERC20,
            rewardToken,
            rewardAmount,
            rewardStartsAt,
            rewardDuration
        );
    }

    /**
     * @dev Cancels a pool (only pool creator can call)
     * @param poolId The ID of the pool to cancel
     * @notice INTENTIONAL DESIGN: Pool creators can cancel their pools at any time, even during active staking periods.
     *         This may impact stakers who committed tokens expecting ongoing reward distribution for the full duration.
     *         Stakers risk losing expected future rewards when creators exercise this cancellation right.
     *         This design prioritizes creator flexibility over staker reward guarantees.
     */
    function cancelPool(
        uint256 poolId
    ) external nonReentrant _checkPoolExists(poolId) {
        Pool storage pool = pools[poolId];
        if (msg.sender != pool.creator) revert Stake__Unauthorized();
        if (pool.cancelledAt > 0) revert Stake__PoolCancelled(); // Already cancelled

        // Update pool rewards up to cancellation time
        _updatePool(poolId);

        uint40 currentTime = uint40(block.timestamp);

        // Calculate leftover rewards to return to creator
        // Only return rewards that haven't been allocated to users yet
        // This prevents precision loss from permanently locking tokens and ensures
        // that users can still claim rewards they've earned even after cancellation
        uint256 leftoverRewards = pool.rewardAmount -
            pool.totalAllocatedRewards;

        // Set cancellation time
        pool.cancelledAt = currentTime;

        // Return leftover rewards to creator if any
        if (leftoverRewards > 0) {
            // Conditions that should never happen
            assert(leftoverRewards <= pool.rewardAmount);
            assert(
                leftoverRewards <=
                    IERC20(pool.rewardToken).balanceOf(address(this))
            );

            // Reward tokens are always ERC20
            IERC20(pool.rewardToken).safeTransfer(
                pool.creator,
                leftoverRewards
            );
        }

        emit PoolCancelled(poolId, leftoverRewards);
    }

    // MARK: - Stake Operations

    /**
     * @dev Stakes tokens into a pool to earn rewards
     * @param poolId The ID of the pool to stake in
     * @param amount The amount of tokens to stake
     */
    function stake(
        uint256 poolId,
        uint104 amount
    ) external nonReentrant _checkPoolExists(poolId) {
        if (amount == 0) revert Stake__ZeroAmount();

        Pool storage pool = pools[poolId];

        if (pool.cancelledAt > 0) revert Stake__PoolCancelled();

        // Cache frequently accessed storage values for gas efficiency
        uint40 rewardStartedAt = pool.rewardStartedAt;

        // Users can stake anytime now (pre-staking allowed), but check if rewards period has ended
        if (
            rewardStartedAt > 0 &&
            block.timestamp >= rewardStartedAt + pool.rewardDuration
        ) {
            revert Stake__PoolFinished();
        }

        UserStake storage userStake = userPoolStake[msg.sender][poolId];

        // safely checks for overflow and reverts with the custom error
        if (
            type(uint104).max - amount < userStake.stakedAmount ||
            type(uint128).max - amount < pool.totalStaked
        ) revert Stake__StakeAmountTooLarge();

        // If this is the first stake in the pool, initialize the reward clock
        if (rewardStartedAt == 0) {
            uint40 currentTime = uint40(block.timestamp);
            uint40 rewardStartsAt = pool.rewardStartsAt;

            if (currentTime >= rewardStartsAt) {
                // Start rewards immediately if we're past the scheduled start time
                pool.rewardStartedAt = currentTime;
                pool.lastRewardUpdatedAt = currentTime;
            } else {
                // Schedule rewards to start at rewardStartsAt (allow pre-staking)
                pool.rewardStartedAt = rewardStartsAt;
                pool.lastRewardUpdatedAt = rewardStartsAt;
            }
        }

        _updatePool(poolId);

        // If user has existing stake, claim pending rewards first to preserve them
        if (userStake.stakedAmount > 0) {
            _claimRewards(poolId, msg.sender);
        } else {
            // First time staking in this pool
            pool.activeStakerCount++;
        }

        // Update user's staked amount
        userStake.stakedAmount += amount;
        userStake.rewardDebt = Math.mulDiv(
            userStake.stakedAmount,
            pool.accRewardPerShare,
            REWARD_PRECISION
        );

        // Update pool's total staked amount
        pool.totalStaked += amount;

        // Transfer tokens from user to contract with balance check to prevent transfer fees/rebasing tokens
        _safeTransferFrom(
            pool.stakingToken,
            pool.isStakingTokenERC20,
            msg.sender,
            address(this),
            amount
        );

        emit Staked(poolId, msg.sender, amount);
    }

    /**
     * @dev Unstakes tokens from a pool
     * @param poolId The ID of the pool to unstake from
     * @param amount The amount of tokens to unstake
     */
    function unstake(
        uint256 poolId,
        uint104 amount
    ) external nonReentrant _checkPoolExists(poolId) {
        _unstake(poolId, amount, true);
    }

    /**
     * @dev Emergency unstake function that allows users to withdraw ALL their staking tokens
     * without claiming rewards. Use this if reward claims are failing due to malicious reward tokens.
     * WARNING: Any accumulated rewards will be forfeited and permanently locked in the contract.
     * @param poolId The ID of the pool to unstake from
     */
    function emergencyUnstake(
        uint256 poolId
    ) external nonReentrant _checkPoolExists(poolId) {
        // Unstake the total staked amount
        _unstake(poolId, userPoolStake[msg.sender][poolId].stakedAmount, false);
    }

    /**
     * @dev Internal function to handle unstaking logic
     * @param poolId The ID of the pool to unstake from
     * @param amount The amount of tokens to unstake
     * @param shouldClaimRewards Whether to claim rewards before unstaking
     */
    function _unstake(
        uint256 poolId,
        uint104 amount,
        bool shouldClaimRewards
    ) internal {
        if (amount == 0) revert Stake__ZeroAmount();

        Pool storage pool = pools[poolId];
        UserStake storage userStake = userPoolStake[msg.sender][poolId];

        if (userStake.stakedAmount < amount)
            revert Stake__InsufficientBalance();

        _updatePool(poolId);

        // Regular unstake: claim rewards
        if (shouldClaimRewards) {
            _claimRewards(poolId, msg.sender); // Transfers rewards and updates rewardDebt
        }
        // Emergency unstake: skip reward claiming (rewards are forfeited)

        // Update user and pool's staked amount
        unchecked {
            userStake.stakedAmount -= amount; // Safe: checked above
            pool.totalStaked -= amount; // Safe: total always >= user amount
        }

        // Reset rewardDebt for both regular and emergency unstake
        userStake.rewardDebt = Math.mulDiv(
            userStake.stakedAmount,
            pool.accRewardPerShare,
            REWARD_PRECISION
        );

        // If user completely unstaked, decrement active staker count
        if (userStake.stakedAmount == 0) {
            pool.activeStakerCount--;
        }

        // If everyone has unstaked before rewards actually started, reset the reward clock
        // This prevents "wasted" rewards during periods when no one is staked
        if (
            pool.totalStaked == 0 &&
            pool.rewardStartedAt > 0 &&
            block.timestamp < pool.rewardStartedAt
        ) {
            pool.rewardStartedAt = 0;
            pool.lastRewardUpdatedAt = 0;
        }

        // Transfer tokens back to user
        if (pool.isStakingTokenERC20) {
            IERC20(pool.stakingToken).safeTransfer(msg.sender, amount);
        } else {
            // For ERC1155, we use token ID 0 only
            IERC1155(pool.stakingToken).safeTransferFrom(
                address(this),
                msg.sender,
                0,
                amount,
                ""
            );
        }

        emit Unstaked(poolId, msg.sender, amount, shouldClaimRewards);
    }

    /**
     * @dev Claims rewards from a pool
     * @param poolId The ID of the pool to claim rewards from
     */
    function claim(
        uint256 poolId
    ) external nonReentrant _checkPoolExists(poolId) {
        _updatePool(poolId);

        _claimRewards(poolId, msg.sender);
    }

    // MARK: - Admin Functions

    function updateProtocolBeneficiary(
        address protocolBeneficiary_
    ) public onlyOwner {
        if (protocolBeneficiary_ == address(0)) revert Stake__InvalidAddress();

        address oldBeneficiary = protocolBeneficiary;
        protocolBeneficiary = protocolBeneficiary_;
        emit ProtocolBeneficiaryUpdated(oldBeneficiary, protocolBeneficiary_);
    }

    function updateCreationFee(uint256 creationFee_) public onlyOwner {
        uint256 oldFee = creationFee;
        creationFee = creationFee_;

        emit CreationFeeUpdated(oldFee, creationFee_);
    }

    function updateClaimFee(uint256 claimFee_) public onlyOwner {
        if (claimFee_ > MAX_CLAIM_FEE) revert Stake__InvalidClaimFee();
        uint256 oldFee = claimFee;
        claimFee = claimFee_;
        emit ClaimFeeUpdated(oldFee, claimFee_);
    }

    // MARK: - View Functions

    /**
     * @dev Returns claimable reward for a user in a specific pool
     * @param poolId The ID of the pool
     * @param staker The address of the staker
     * @return rewardClaimable The amount of rewards that can be claimed
     * @return fee The fee for claiming rewards
     * @return claimedTotal The total amount of rewards already claimed
     * @return feeTotal The total amount of fees already claimed
     */
    function claimableReward(
        uint256 poolId,
        address staker
    )
        external
        view
        _checkPoolExists(poolId)
        returns (
            uint256 rewardClaimable,
            uint256 fee,
            uint256 claimedTotal,
            uint256 feeTotal
        )
    {
        Pool memory pool = pools[poolId];
        UserStake memory userStake = userPoolStake[staker][poolId];

        (rewardClaimable, fee) = _claimableReward(
            _getUpdatedAccRewardPerShare(pool),
            userStake.stakedAmount,
            userStake.rewardDebt
        );

        claimedTotal = userStake.claimedTotal;
        feeTotal = userStake.feeTotal;
    }

    /**
     * @dev Returns claimable rewards for multiple pools that user have engaged (staked > 0 or claimable > 0 or claimed > 0)
     * @param poolIdFrom The starting pool ID
     * @param poolIdTo The ending pool ID (exclusive)
     * @param staker The address of the staker
     * @return results Array of [poolId, rewardClaimable, fee, claimedTotal, feeTotal] for pools with rewards only
     */
    function claimableRewardBulk(
        uint256 poolIdFrom,
        uint256 poolIdTo,
        address staker
    ) external view returns (uint256[5][] memory results) {
        if (poolIdFrom >= poolIdTo || poolIdTo - poolIdFrom > 1000) {
            revert Stake__InvalidPaginationParameters();
        }

        unchecked {
            // Limit search to actual pool count
            uint256 searchTo = poolIdTo > poolCount ? poolCount : poolIdTo;
            if (poolIdFrom >= searchTo) {
                return new uint256[5][](0);
            }

            // Single pass: collect results in temporary array, then resize
            uint256 maxLength = searchTo - poolIdFrom;
            uint256[5][] memory tempResults = new uint256[5][](maxLength);
            uint256 validCount = 0;

            for (uint256 i = poolIdFrom; i < searchTo; ++i) {
                UserStake memory userStake = userPoolStake[staker][i];

                // Skip if user has not engaged with the pool
                if (userStake.stakedAmount == 0 && userStake.claimedTotal == 0)
                    continue;

                // If the user currently has no staked amount, all rewards are claimed because unstaking claims all pending rewards
                // We can simply return the claimed total and fee total
                if (userStake.stakedAmount == 0) {
                    tempResults[validCount] = [
                        i,
                        0,
                        0,
                        userStake.claimedTotal,
                        userStake.feeTotal
                    ];
                    ++validCount;
                    continue;
                }

                // Now, staked > 0, so we need to calculate the claimable reward
                (uint256 claimable, uint256 fee) = _claimableReward(
                    _getUpdatedAccRewardPerShare(pools[i]),
                    userStake.stakedAmount,
                    userStake.rewardDebt
                );

                tempResults[validCount] = [
                    i,
                    claimable,
                    fee,
                    userStake.claimedTotal,
                    userStake.feeTotal
                ];
                ++validCount;
            }

            // Create final array with exact size and copy results
            results = new uint256[5][](validCount);
            for (uint256 i = 0; i < validCount; ++i) {
                results[i] = tempResults[i];
            }
        }
    }

    // Struct and view helper functions for getPool and getPools
    struct TokenInfo {
        string symbol;
        string name;
        uint8 decimals;
    }
    struct PoolView {
        uint256 poolId;
        Pool pool;
        TokenInfo stakingToken;
        TokenInfo rewardToken;
    }

    /**
     * @dev Safely fetch token metadata with gas limits to prevent DoS
     * @param tokenAddress The token contract address
     * @return TokenInfo struct with token metadata
     */
    function _getTokenInfo(
        address tokenAddress
    ) internal view returns (TokenInfo memory) {
        string memory symbol = "undefined";
        string memory name = "undefined";
        uint8 decimals = 0;

        // Get symbol with gas limit
        (bool successSymbol, bytes memory dataSymbol) = tokenAddress.staticcall{
            gas: METADATA_GAS_STIPEND
        }(abi.encodeWithSignature("symbol()"));

        if (successSymbol && dataSymbol.length >= 64) {
            symbol = abi.decode(dataSymbol, (string));
        }

        // Get name with gas limit
        (bool successName, bytes memory dataName) = tokenAddress.staticcall{
            gas: METADATA_GAS_STIPEND
        }(abi.encodeWithSignature("name()"));

        if (successName && dataName.length >= 64) {
            name = abi.decode(dataName, (string));
        }

        // Get decimals with gas limit
        (bool successDecimals, bytes memory dataDecimals) = tokenAddress
            .staticcall{gas: METADATA_GAS_STIPEND}(
            abi.encodeWithSignature("decimals()")
        );

        if (successDecimals && dataDecimals.length == 32) {
            decimals = abi.decode(dataDecimals, (uint8));
        }

        return TokenInfo({symbol: symbol, name: name, decimals: decimals});
    }

    /**
     * @dev Returns pool information for a single pool
     * @param poolId The ID of the pool
     * @return poolView The pool information
     */
    function getPool(
        uint256 poolId
    ) external view _checkPoolExists(poolId) returns (PoolView memory) {
        Pool memory pool = pools[poolId];
        TokenInfo memory stakingTokenInfo = _getTokenInfo(pool.stakingToken);
        TokenInfo memory rewardTokenInfo = _getTokenInfo(pool.rewardToken);

        return PoolView(poolId, pool, stakingTokenInfo, rewardTokenInfo);
    }

    /**
     * @dev Returns pool information for a range of pools
     * @param poolIdFrom The starting pool ID
     * @param poolIdTo The ending pool ID (exclusive)
     * @return poolList Array of Pool structs
     */
    function getPools(
        uint256 poolIdFrom,
        uint256 poolIdTo
    ) external view returns (PoolView[] memory poolList) {
        if (
            poolIdFrom >= poolIdTo || poolIdTo - poolIdFrom > MAX_ITEMS_PER_PAGE
        ) {
            revert Stake__InvalidPaginationParameters();
        }

        uint256 end = poolIdTo > poolCount ? poolCount : poolIdTo;
        if (poolIdFrom >= end) {
            return new PoolView[](0);
        }

        uint256 length = end - poolIdFrom;
        poolList = new PoolView[](length);
        for (uint256 i = 0; i < length; ++i) {
            uint256 poolId = poolIdFrom + i;
            Pool memory pool = pools[poolId];
            poolList[i] = PoolView({
                poolId: poolId,
                pool: pool,
                stakingToken: _getTokenInfo(pool.stakingToken),
                rewardToken: _getTokenInfo(pool.rewardToken)
            });
        }
    }

    /**
     * @dev Returns pool information for pools created by a specific creator within a range
     * @param poolIdFrom The starting pool ID (inclusive)
     * @param poolIdTo The ending pool ID (exclusive)
     * @param creator The address of the pool creator to filter by
     * @return poolList Array of PoolView structs for pools created by the specified creator
     * @notice This function filters pools by creator and returns only matching pools
     *         The returned array size will match the number of pools found, not the input range
     */
    function getPoolsByCreator(
        uint256 poolIdFrom,
        uint256 poolIdTo,
        address creator
    ) external view returns (PoolView[] memory poolList) {
        if (
            poolIdFrom >= poolIdTo || poolIdTo - poolIdFrom > MAX_ITEMS_PER_PAGE
        ) {
            revert Stake__InvalidPaginationParameters();
        }

        unchecked {
            // Limit search to actual pool count
            uint256 searchTo = poolIdTo > poolCount ? poolCount : poolIdTo;
            if (poolIdFrom >= searchTo) {
                return new PoolView[](0);
            }

            // Single pass: collect results in temporary array, then resize
            uint256 maxLength = searchTo - poolIdFrom;
            PoolView[] memory tempResults = new PoolView[](maxLength);
            uint256 validCount = 0;

            for (uint256 i = poolIdFrom; i < searchTo; ++i) {
                Pool memory pool = pools[i];

                // Skip pools not created by the specified creator
                if (pool.creator != creator) continue;

                tempResults[validCount] = PoolView({
                    poolId: i,
                    pool: pool,
                    stakingToken: _getTokenInfo(pool.stakingToken),
                    rewardToken: _getTokenInfo(pool.rewardToken)
                });
                ++validCount;
            }

            // Create final array with exact size and copy results
            poolList = new PoolView[](validCount);
            for (uint256 i = 0; i < validCount; ++i) {
                poolList[i] = tempResults[i];
            }
        }
    }

    /**
     * @dev Returns the version of the contract
     * @return The version string
     */
    function version() external pure returns (string memory) {
        return "1.0.0";
    }

    // MARK: - ERC1155 Receiver

    /**
     * @dev Handles the receipt of a single ERC1155 token type. This function is
     * called at the end of a `safeTransferFrom` after the balance has been updated.
     * Required for the contract to receive ERC1155 tokens.
     */
    function onERC1155Received(
        address,
        address,
        uint256 id,
        uint256,
        bytes memory
    ) external pure returns (bytes4) {
        if (id != 0) revert Stake__InvalidTokenId();

        return this.onERC1155Received.selector;
    }
}
