import { TX_VALIDITY_WINDOW, TX_MIN_VALIDITY_DURATION } from './Constants';
import { State } from '@nimiq/rpc';
import {
    BasicRequest,
    SimpleRequest,
    SignTransactionRequest,
    CheckoutRequest,
    SignMessageRequest,
    RenameRequest,
    RpcRequest,
} from './PublicRequestTypes';
import {
    RequestType,
    ParsedBasicRequest,
    ParsedSimpleRequest,
    ParsedSignTransactionRequest,
    ParsedCheckoutRequest,
    ParsedSignMessageRequest,
    ParsedRenameRequest,
    ParsedRpcRequest,
} from './RequestTypes';
import { Utf8Tools } from '@nimiq/utils';

export class RequestParser {
    public static parse(request: RpcRequest, state: State, requestType: RequestType): ParsedRpcRequest | null {
        if (!request.appName) throw new Error('appName is required');

        switch (requestType) {
            case RequestType.SIGN_TRANSACTION:
                const signTransactionRequest = request as SignTransactionRequest;

                if (!signTransactionRequest.value) throw new Error('value is required');
                if (!signTransactionRequest.validityStartHeight) throw new Error('validityStartHeight is required');

                return {
                    kind: RequestType.SIGN_TRANSACTION,
                    appName: signTransactionRequest.appName,
                    sender: Nimiq.Address.fromUserFriendlyAddress(signTransactionRequest.sender),
                    recipient: Nimiq.Address.fromUserFriendlyAddress(signTransactionRequest.recipient),
                    recipientType: signTransactionRequest.recipientType || Nimiq.Account.Type.BASIC,
                    value: signTransactionRequest.value,
                    fee: signTransactionRequest.fee || 0,
                    data: typeof signTransactionRequest.extraData === 'string'
                        ? Utf8Tools.stringToUtf8ByteArray(signTransactionRequest.extraData)
                        : signTransactionRequest.extraData || new Uint8Array(0),
                    flags: signTransactionRequest.flags || Nimiq.Transaction.Flag.NONE,
                    validityStartHeight: signTransactionRequest.validityStartHeight,
                } as ParsedSignTransactionRequest;
            case RequestType.CHECKOUT:
                const checkoutRequest = request as CheckoutRequest;

                if (!checkoutRequest.value) throw new Error('value is required');
                if (checkoutRequest.shopLogoUrl && new URL(checkoutRequest.shopLogoUrl).origin !== state.origin) {
                    throw new Error(
                        'shopLogoUrl must have same origin as caller website. Image at ' +
                        checkoutRequest.shopLogoUrl +
                        ' is not on caller origin ' +
                        state.origin);
                }
                return {
                    kind: RequestType.CHECKOUT,
                    appName: checkoutRequest.appName,
                    shopLogoUrl: checkoutRequest.shopLogoUrl,
                    recipient: Nimiq.Address.fromUserFriendlyAddress(checkoutRequest.recipient),
                    recipientType: checkoutRequest.recipientType || Nimiq.Account.Type.BASIC,
                    value: checkoutRequest.value,
                    fee: checkoutRequest.fee || 0,
                    data: typeof checkoutRequest.extraData === 'string'
                        ? Utf8Tools.stringToUtf8ByteArray(checkoutRequest.extraData)
                        : checkoutRequest.extraData || new Uint8Array(0),
                    flags: checkoutRequest.flags || Nimiq.Transaction.Flag.NONE,
                    validityDuration: !checkoutRequest.validityDuration ? TX_VALIDITY_WINDOW : Math.min(
                        TX_VALIDITY_WINDOW,
                        Math.max(
                            TX_MIN_VALIDITY_DURATION,
                            checkoutRequest.validityDuration,
                        ),
                    ),
                } as ParsedCheckoutRequest;
            case RequestType.ONBOARD:
            case RequestType.SIGNUP:
            case RequestType.CHOOSE_ADDRESS:
            case RequestType.LOGIN:
            case RequestType.MIGRATE:
                return {
                    kind: requestType,
                    appName: request.appName,
                } as ParsedBasicRequest;
            case RequestType.EXPORT:
            case RequestType.CHANGE_PASSWORD:
            case RequestType.LOGOUT:
            case RequestType.ADD_ADDRESS:
                const simpleRequest = request as SimpleRequest;

                if (!simpleRequest.accountId) throw new Error('accountId is required');

                return {
                    kind: requestType,
                    appName: simpleRequest.appName,
                    walletId: simpleRequest.accountId,
                } as ParsedSimpleRequest;
            case RequestType.RENAME:
                const renameRequest = request as RenameRequest;

                if (!renameRequest.accountId) throw new Error('accountId is required');

                return {
                    kind: RequestType.RENAME,
                    appName: renameRequest.appName,
                    walletId: renameRequest.accountId,
                    address: renameRequest.address,
                } as ParsedRenameRequest;
            case RequestType.SIGN_MESSAGE:
                const signMessageRequest = request as SignMessageRequest;
                if (typeof signMessageRequest.message !== 'string'
                    && !(signMessageRequest.message instanceof Uint8Array)) {
                    throw new Error('message must be a string or Uint8Array');
                }
                return {
                    kind: RequestType.SIGN_MESSAGE,
                    appName: signMessageRequest.appName,
                    signer: signMessageRequest.signer
                            ? Nimiq.Address.fromUserFriendlyAddress(signMessageRequest.signer)
                            : undefined,
                    message: signMessageRequest.message,
                } as ParsedSignMessageRequest;
            default:
                return null;
        }
    }

    public static raw(request: ParsedRpcRequest): RpcRequest | null {
        switch (request.kind) {
            case RequestType.SIGN_TRANSACTION:
                const signTransactionRequest = request as ParsedSignTransactionRequest;
                return {
                    appName: signTransactionRequest.appName,
                    sender: signTransactionRequest.sender.toUserFriendlyAddress(),
                    recipient: signTransactionRequest.recipient.toUserFriendlyAddress(),
                    recipientType: signTransactionRequest.recipientType,
                    value: signTransactionRequest.value,
                    fee: signTransactionRequest.fee,
                    extraData: signTransactionRequest.data,
                    flags: signTransactionRequest.flags,
                    validityStartHeight: signTransactionRequest.validityStartHeight,
                } as SignTransactionRequest;
            case RequestType.CHECKOUT:
                const checkoutRequest = request as ParsedCheckoutRequest;
                return {
                    appName: checkoutRequest.appName,
                    shopLogoUrl: checkoutRequest.shopLogoUrl,
                    recipient: checkoutRequest.recipient.toUserFriendlyAddress(),
                    recipientType: checkoutRequest.recipientType,
                    value: checkoutRequest.value,
                    fee: checkoutRequest.fee,
                    extraData: checkoutRequest.data,
                    flags: checkoutRequest.flags,
                    validityDuration: checkoutRequest.validityDuration,
                } as CheckoutRequest;
            case RequestType.MIGRATE:
            case RequestType.ONBOARD:
            case RequestType.SIGNUP:
            case RequestType.CHOOSE_ADDRESS:
            case RequestType.LOGIN:
                return {
                    appName: request.appName,
                } as BasicRequest;
            case RequestType.EXPORT:
            case RequestType.CHANGE_PASSWORD:
            case RequestType.LOGOUT:
            case RequestType.ADD_ADDRESS:
                const simpleRequest = request as ParsedSimpleRequest;
                return {
                    appName: simpleRequest.appName,
                    accountId: simpleRequest.walletId,
                } as SimpleRequest;
            case RequestType.RENAME:
                const renameRequest = request as ParsedRenameRequest;
                return {
                    appName: renameRequest.appName,
                    accountId: renameRequest.walletId,
                    address: renameRequest.address,
                } as RenameRequest;
            case RequestType.SIGN_MESSAGE:
                const signMessageRequest = request as ParsedSignMessageRequest;
                return {
                    appName: signMessageRequest.appName,
                    signer: signMessageRequest.signer ? signMessageRequest.signer.toUserFriendlyAddress() : undefined,
                    message: signMessageRequest.message,
                } as SignMessageRequest;
            default:
                return null;
        }
    }
}
