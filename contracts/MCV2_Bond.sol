// SPDX-License-Identifier: BSD-3-Clause

pragma solidity ^0.8.20;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {MCV2_Royalty} from "./MCV2_Royalty.sol";
import {MCV2_Token} from "./MCV2_Token.sol"; // TODO: Create interface
import {MCV2_MultiToken} from "./MCV2_MultiToken.sol"; // TODO: Create interface
import {MCV2_ICommonToken} from "./lib/MCV2_ICommonToken.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/**
* @title MintClub Bond V2
* Providing liquidity for MintClubV2 tokens with a bonding curve.
*/
contract MCV2_Bond is MCV2_Royalty {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    error MCV2_Bond__InvalidTokenCreationParams(string reason);
    error MCV2_Bond__InvalidReserveToken(string reason);
    error MCV2_Bond__InvalidStepParams(string reason);
    error MCV2_Bond__TokenSymbolAlreadyExists();
    error MCV2_Bond__TokenNotFound();
    error MCV2_Bond__ExceedMaxSupply();
    error MCV2_Bond__SlippageLimitExceeded();
    error MCV2_Bond__InvalidTokenAmount();
    error MCV2_Bond__ExceedTotalSupply();
    error MCV2_Bond__InvalidRefundAmount();
    error MCV2_Bond__InvalidCurrentSupply();
    error MCV2_Bond__PermissionDenied();

    uint256 private constant MAX_STEPS = 1000;

    /**
     *  ERC20 Token implementation contract
     *  We use "EIP-1167: Minimal Proxy Contract" in order to save gas cost for each token deployment
     *  REF: https://github.com/optionality/clone-factory
     */
    address private immutable tokenImplementation;
    address private immutable multiTokenImplementation;

    struct Bond {
        address creator;
        uint16 royalty; // immutable - range: [0, 5000] - 0.00% ~ 50.00%
        uint40 createdAt; // immutable
        address reserveToken; // immutable
        uint256 reserveBalance;
        BondStep[] steps; // immutable
    }

    // Use uint128 to save storage cost & prevent integer overflow when calculating range * price
    struct BondStep {
        uint128 rangeTo;
        uint128 price; // multiplied by 10**18 for decimals
    }

    // Optional on-chain metadata for the token
    struct MetaData {
        string logo;
        string website;
    }

    mapping (address => Bond) public tokenBond;
    mapping (address => MetaData) public tokenMetaData;
    address[] public tokens; // Array of all created tokens

    event TokenCreated(address indexed token, string name, string symbol, address indexed reserveToken);
    event MultiTokenCreated(address indexed token, string name, string symbol, string uri, address indexed reserveToken);
    event Mint(address indexed token, address indexed user, uint256 amountMinted, address indexed reserveToken, uint256 reserveAmount);
    event Burn(address indexed token, address indexed user, uint256 amountBurned, address indexed reserveToken, uint256 refundAmount);
    event BondCreatorUpdated(address indexed token, address indexed creator);
    event TokenMetaDataUpdated(address indexed token, string logo, string website);

    // MARK: - Constructor

    constructor(
        address tokenImplementation_,
        address multiTokenImplementation_,
        address protocolBeneficiary_
    ) MCV2_Royalty(protocolBeneficiary_, msg.sender) {
        tokenImplementation = tokenImplementation_;
        multiTokenImplementation = multiTokenImplementation_;
    }

    modifier _checkBondExists(address token) {
        if(tokenBond[token].reserveToken == address(0)) revert MCV2_Bond__TokenNotFound();
        _;
    }

    // MARK: - Factory

    // Use structs to avoid stack too deep error
    struct TokenParams {
        string name;
        string symbol;
    }

    struct MultiTokenParams {
        string name;
        string symbol;
        string uri;
    }

    struct BondParams {
        uint16 royalty;
        address reserveToken;
        uint128 maxSupply;
        uint128[] stepRanges;
        uint128[] stepPrices;
    }

    function _validateTokenParams(TokenParams calldata tp) pure private {
        if (bytes(tp.name).length == 0) revert MCV2_Bond__InvalidTokenCreationParams('name');
        if (bytes(tp.symbol).length == 0) revert MCV2_Bond__InvalidTokenCreationParams('symbol');
    }

    function _validateMultiTokenParams(MultiTokenParams calldata tp) pure private {
        if (bytes(tp.name).length == 0) revert MCV2_Bond__InvalidTokenCreationParams('name');
        if (bytes(tp.symbol).length == 0) revert MCV2_Bond__InvalidTokenCreationParams('symbol');
        if (bytes(tp.uri).length == 0) revert MCV2_Bond__InvalidTokenCreationParams('uri');
    }

    // Check if the contract has the method with the minimum length of the return data
    // - uint8 = 32 bytes
    // - empty string = 64 bytes (32:length + 32:padding)
    function _checkMethodExists(address implementation, string memory method, uint256 minLength) private view returns (bool) {
        (bool success, bytes memory data) = implementation.staticcall(abi.encodeWithSignature(method));
        return success && data.length > minLength;
    }

    function _validateBondParams(BondParams calldata bp) view private {
        if (bp.royalty > MAX_ROYALTY_RANGE) revert MCV2_Bond__InvalidTokenCreationParams('royalty');

        // Check if the reserveToken is compatible with IERC20Metadata
        address r = bp.reserveToken;
        if (r == address(0)) revert MCV2_Bond__InvalidTokenCreationParams('reserveToken');
        if(!_checkMethodExists(r, "decimals()", 31)) revert MCV2_Bond__InvalidReserveToken('decimals');
        if(!_checkMethodExists(r, "name()", 64)) revert MCV2_Bond__InvalidReserveToken('name');
        if(!_checkMethodExists(r, "symbol()", 64)) revert MCV2_Bond__InvalidReserveToken('symbol');

        if (bp.maxSupply == 0) revert MCV2_Bond__InvalidTokenCreationParams('maxSupply');
        if (bp.stepRanges.length == 0 || bp.stepRanges.length > MAX_STEPS) revert MCV2_Bond__InvalidStepParams('INVALID_STEP_LENGTH');
        if (bp.stepRanges.length != bp.stepPrices.length) revert MCV2_Bond__InvalidStepParams('STEP_LENGTH_DO_NOT_MATCH');
        // Last value or the rangeTo must be the same as the maxSupply
        if (bp.stepRanges[bp.stepRanges.length - 1] != bp.maxSupply) revert MCV2_Bond__InvalidStepParams('MAX_SUPPLY_MISMATCH');
    }

    function _setBond(address token, BondParams calldata bp) private {
        // Set token bond data
        Bond storage bond = tokenBond[token];
        bond.creator = _msgSender();
        bond.royalty = bp.royalty;
        bond.createdAt = uint40(block.timestamp);
        bond.reserveToken = bp.reserveToken;

        for (uint256 i = 0; i < bp.stepRanges.length; ++i) {
            if (bp.stepRanges[i] == 0) revert MCV2_Bond__InvalidStepParams('STEP_CANNOT_BE_ZERO');

            // Ranges and prices must be strictly increasing
            if (i > 0) {
                if (bp.stepRanges[i] <= bp.stepRanges[i - 1]) revert MCV2_Bond__InvalidStepParams('DECREASING_RANGE');
                if (bp.stepPrices[i] <= bp.stepPrices[i - 1]) revert MCV2_Bond__InvalidStepParams('DECREASING_PRICE');
            }

            bond.steps.push(BondStep({
                rangeTo: bp.stepRanges[i],
                price: bp.stepPrices[i]
            }));
        }
    }

    function _clone(address implementation, string calldata symbol) private returns (address) {
        // Uniqueness of symbols on this network is guaranteed by the deterministic contract address
        bytes32 salt = keccak256(abi.encodePacked(address(this), symbol));

        // NOTE: This check might not be necessary as the clone would fail with an 'ERC1167: create2 failed'
        // error anyway, and the collision is nearly impossible (one in 2^160).
        // However, we retain this check to provide a clearer error message, albeit at the expense of an additional gas cost.
        address predicted = Clones.predictDeterministicAddress(implementation, salt);
        if (exists(predicted)) revert MCV2_Bond__TokenSymbolAlreadyExists();

        return Clones.cloneDeterministic(implementation, salt);
    }

    function createToken(TokenParams calldata tp, BondParams calldata bp) external returns (address) {
        _validateTokenParams(tp);
        _validateBondParams(bp);

        address token = _clone(tokenImplementation, tp.symbol);
        MCV2_Token newToken = MCV2_Token(token);
        newToken.init(tp.name, tp.symbol);
        tokens.push(token);

        _setBond(token, bp);

        emit TokenCreated(token, tp.name, tp.symbol, bp.reserveToken);

        // Send free tokens to the creator if a free minting range exists
        if (bp.stepPrices[0] == 0) {
            newToken.mintByBond(_msgSender(), bp.stepRanges[0]);
        }

        return token;
    }

    function createMultiToken(MultiTokenParams calldata tp, BondParams calldata bp) external returns (address) {
        _validateMultiTokenParams(tp);
        _validateBondParams(bp);

        address token = _clone(multiTokenImplementation, tp.symbol);
        MCV2_MultiToken newToken = MCV2_MultiToken(token);
        newToken.init(tp.name, tp.symbol, tp.uri);
        tokens.push(token);

        _setBond(token, bp);

        emit MultiTokenCreated(token, tp.name, tp.symbol, tp.uri, bp.reserveToken);

        // Send free tokens to the creator if a free minting range exists
        if (bp.stepPrices[0] == 0) {
            newToken.mintByBond(_msgSender(), bp.stepRanges[0]);
        }

        return token;
    }

    // MARK: - Creator only functions

    // Creator receives the royalty.
    // Transferring the creator to the null address means no one can claim the royalty; this means it will be permanently locked in the bond contract.
    function updateBondCreator(address token, address creator) external {
        Bond storage bond = tokenBond[token];
        if (bond.creator != _msgSender()) revert MCV2_Bond__PermissionDenied(); // This will also check the existence of the bond

        bond.creator = creator;

        emit BondCreatorUpdated(token, creator);
    }

    function updateTokenMetaData(address token, string calldata logo, string calldata website) external {
        Bond storage bond = tokenBond[token];
        if (bond.creator != _msgSender()) revert MCV2_Bond__PermissionDenied(); // This will also check the existence of the bond

        MetaData storage metaData = tokenMetaData[token];
        metaData.logo = logo;
        metaData.website = website;

        emit TokenMetaDataUpdated(token, logo, website);
    }

    // MARK: - Mint

    function getCurrentStep(address token, uint256 currentSupply) internal view returns (uint256) {
        Bond storage bond = tokenBond[token];
        for(uint256 i = 0; i < bond.steps.length; ++i) {
            if (currentSupply <= bond.steps[i].rangeTo) {
                return i;
            }
        }
        revert MCV2_Bond__InvalidCurrentSupply(); // can never happen
    }

    function getReserveForToken(address token, uint256 tokensToMint) public view _checkBondExists(token)
        returns (uint256 reserveAmount, uint256 royalty)
    {
        if (tokensToMint == 0) revert MCV2_Bond__InvalidTokenAmount();

        Bond storage bond = tokenBond[token];
        // Create an array and variable to mention that this can be modified.
        BondStep[] storage steps = bond.steps;

        MCV2_ICommonToken t = MCV2_ICommonToken(token);
        uint256 currentSupply = t.totalSupply();
        uint256 newSupply = currentSupply + tokensToMint;

        if (newSupply > maxSupply(token)) revert MCV2_Bond__ExceedMaxSupply();

        uint256 multiFactor = 10**t.decimals();
        uint256 tokensLeft = tokensToMint;
        uint256 reserveToBond = 0;
        uint256 supplyLeft;
        for (uint256 i = getCurrentStep(token, currentSupply); i < steps.length; ++i) {
            supplyLeft = steps[i].rangeTo - currentSupply;

            if (supplyLeft < tokensLeft) {
                // ensure reserve is calculated with ceiling
                reserveToBond += Math.ceilDiv(supplyLeft * steps[i].price, multiFactor);
                currentSupply += supplyLeft;
                tokensLeft -= supplyLeft;
            } else {
                // ensure reserve is calculated with ceiling
                reserveToBond += Math.ceilDiv(tokensLeft * steps[i].price, multiFactor);
                tokensLeft = 0;
                break;
            }
        }

        if (reserveToBond == 0 || tokensLeft > 0) revert MCV2_Bond__InvalidTokenAmount(); // can never happen

        royalty = getRoyalty(reserveToBond, bond.royalty);
        reserveAmount = reserveToBond + royalty;
    }

    function mint(address token, uint256 tokensToMint, uint256 maxReserveAmount) external {
        (uint256 reserveAmount, uint256 royalty) = getReserveForToken(token, tokensToMint);
        if (reserveAmount > maxReserveAmount) revert MCV2_Bond__SlippageLimitExceeded();

        Bond storage bond = tokenBond[token];
        address user = _msgSender();

        // Transfer reserve tokens
        IERC20 reserveToken = IERC20(bond.reserveToken);
        reserveToken.safeTransferFrom(user, address(this), reserveAmount);

        // Update reserve & fee balances
        bond.reserveBalance += (reserveAmount - royalty).toUint128();
        addRoyalty(bond.creator, bond.reserveToken, royalty);

        // Mint reward tokens to the user
        MCV2_ICommonToken(token).mintByBond(user, tokensToMint);

        emit Mint(token, user, tokensToMint, bond.reserveToken, reserveAmount);
    }

    // MARK: - Burn

    function getRefundForTokens(address token, uint256 tokensToBurn) public view _checkBondExists(token)
        returns (uint256 refundAmount, uint256 royalty)
    {
        if (tokensToBurn == 0) revert MCV2_Bond__InvalidTokenAmount();

        Bond storage bond = tokenBond[token];
        // Store bond.steps in memory to minimize sloads
        BondStep[] storage steps = bond.steps;

        MCV2_ICommonToken t = MCV2_ICommonToken(token);
        uint256 currentSupply = t.totalSupply();

        if (tokensToBurn > currentSupply) revert MCV2_Bond__ExceedTotalSupply();

        uint256 multiFactor = 10**t.decimals();
        uint256 reserveFromBond;
        uint256 tokensLeft = tokensToBurn;
        uint256 i = getCurrentStep(token, currentSupply);
        while (i >= 0 && tokensLeft > 0) {
            uint256 supplyLeft = i == 0 ? currentSupply : currentSupply - steps[i - 1].rangeTo;

            uint256 tokensToProcess = tokensLeft < supplyLeft ? tokensLeft : supplyLeft;
            reserveFromBond += ((tokensToProcess * steps[i].price) / multiFactor);

            tokensLeft -= tokensToProcess;
            currentSupply -= tokensToProcess;

            if (i > 0) --i;
        }

        if (tokensLeft > 0) revert MCV2_Bond__InvalidTokenAmount(); // can never happen

        royalty = getRoyalty(reserveFromBond, bond.royalty);
        refundAmount = reserveFromBond - royalty;
    }

    function burn(address token, uint256 tokensToBurn, uint256 minRefund) external {
        (uint256 refundAmount, uint256 royalty) = getRefundForTokens(token, tokensToBurn);
        if (refundAmount < minRefund) revert MCV2_Bond__SlippageLimitExceeded();

        Bond storage bond = tokenBond[token];
        address user = _msgSender();

        // Burn tokens from the user
        MCV2_ICommonToken(token).burnByBond(user, tokensToBurn);

        // Update reserve & fee balances
        bond.reserveBalance -= (refundAmount + royalty).toUint128();
        addRoyalty(bond.creator, bond.reserveToken, royalty);

        // Transfer reserve tokens to the user
        IERC20 reserveToken = IERC20(bond.reserveToken);
        reserveToken.safeTransfer(user, refundAmount);

        emit Burn(token, user, tokensToBurn, bond.reserveToken, refundAmount);
    }

    // MARK: - Utility functions

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    function exists(address token) public view returns (bool) {
        return tokenBond[token].reserveToken != address(0);
    }

    function getSteps(address token) external view returns (BondStep[] memory) {
        return tokenBond[token].steps;
    }

    function currentPrice(address token) public view returns (uint128) {
        uint256 currentSupply = MCV2_ICommonToken(token).totalSupply();
        if (currentSupply < maxSupply(token)) {
            ++currentSupply; // Ensure currentSupply is in the next range
        }

        uint256 i = getCurrentStep(token, currentSupply);

        return tokenBond[token].steps[i].price;
    }

    function maxSupply(address token) public view returns (uint128) {
        return tokenBond[token].steps[tokenBond[token].steps.length - 1].rangeTo;
    }

    struct BondInfo {
        address creator;
        address token;
        uint8 decimals;
        string symbol;
        string name;
        string logo;
        string website;
        uint40 createdAt;
        uint128 currentSupply;
        uint128 maxSupply;
        uint128 currentPrice;
        address reserveToken;
        uint8 reserveDecimals;
        string reserveSymbol;
        string reserveName;
        uint256 reserveBalance;
    }
    function _getBondInfo(address token) private view returns(BondInfo memory info) {
        MCV2_ICommonToken t = MCV2_ICommonToken(token);
        Bond memory bond = tokenBond[token];
        MetaData memory metaData = tokenMetaData[token];
        IERC20Metadata r = IERC20Metadata(bond.reserveToken);

        info = BondInfo({
            creator: bond.creator,
            token: token,
            decimals: t.decimals(),
            symbol: t.symbol(),
            name: t.name(),
            logo: metaData.logo,
            website: metaData.website,
            createdAt: bond.createdAt,
            currentSupply: uint128(t.totalSupply()),
            maxSupply: maxSupply(token),
            currentPrice: currentPrice(token),
            reserveToken: bond.reserveToken,
            reserveDecimals: r.decimals(),
            reserveSymbol: r.symbol(),
            reserveName: r.name(),
            reserveBalance: bond.reserveBalance
        });
    }

    // Get all tokens and their bond parameters in the range where start <= id < stop
    function getList(uint256 start, uint256 stop) external view returns(BondInfo[] memory info) {
        unchecked {
            uint256 tokensLength = tokens.length;
            if (stop > tokensLength) {
                stop = tokensLength;
            }

            uint256 arrayLength = stop - start;
            info = new BondInfo[](arrayLength);

            uint256 j;
            for (uint256 i = start; i < stop; ++i) {
                info[j++] = _getBondInfo(tokens[i]);
            }
        }
    }

    struct BondDetail {
        uint16 royalty;
        BondInfo info;
        BondStep[] steps;
    }
    function getDetail(address token) external view returns(BondDetail memory detail) {
        Bond memory bond = tokenBond[token];
        detail = BondDetail({
            royalty: bond.royalty,
            info: _getBondInfo(token),
            steps: bond.steps
        });
    }

    // Get tokens filtered by reserve token in the range where start <= id < stop
    function getTokensByReserveToken(address reserveToken, uint256 start, uint256 stop) external view returns (address[] memory addresses) {
        unchecked {
            uint256 tokensLength = tokens.length;
            if (stop > tokensLength) {
                stop = tokensLength;
            }

            uint256 count;
            for (uint256 i = start; i < stop; ++i) {
                if (tokenBond[tokens[i]].reserveToken == reserveToken) ++count;
            }
            addresses = new address[](count);

            uint256 j = 0;
            for (uint256 i = start; i < stop; ++i) {
                if (tokenBond[tokens[i]].reserveToken == reserveToken){
                    addresses[j++] = tokens[i];
                    if (j == count) break;
                }
            }
        }
    }

    // Get tokens filtered by creator address in the range where start <= id < stop
    function getTokensByCreator(address creator, uint256 start, uint256 stop) external view returns (address[] memory addresses) {
        unchecked {
            uint256 tokensLength = tokens.length;
            if (stop > tokensLength) {
                stop = tokensLength;
            }

            uint256 count;
            for (uint256 i = start; i < stop; ++i) {
                if (tokenBond[tokens[i]].creator == creator) ++count;
            }
            addresses = new address[](count);

            uint256 j = 0;
            for (uint256 i = start; i < stop; ++i) {
                if (tokenBond[tokens[i]].creator == creator){
                    addresses[j++] = tokens[i];
                    if (j == count) break;
                }
            }
        }
    }

    function version() external pure returns (string memory) {
        return "0.1.120";
    }
}