<template>
    <div v-if="title" class="container pad-bottom">
        <SmallPage>
            <Loader
                :title="title"
                :state="state"
                :message="message"
                :mainAction="mainActionText"
                :alternativeAction="alternativeActionText"
                @main-action="mainActionHandler"
                @alternative-action="alternativeActionHandler"
                />
        </SmallPage>
    </div>
</template>

<script lang="ts">
import { Component, Vue } from 'vue-property-decorator';
import { State } from 'vuex-class';
import staticStore, { Static } from '../lib/StaticStore';
import { ParsedRpcRequest, ParsedSimpleRequest, RequestType } from '../lib/RequestTypes';
import { Errors } from '@nimiq/keyguard-client';
import { WalletStore } from '../lib/WalletStore';
import KeyguardClient from '@nimiq/keyguard-client';
import { SmallPage } from '@nimiq/vue-components';
import Loader from '../components/Loader.vue';
import { ERROR_ACCOUNT_REMOVED } from '../lib/Constants';

@Component({components: {SmallPage, Loader}})
export default class ErrorHandler extends Vue {
    @Static protected request!: ParsedRpcRequest;
    @Static protected keyguardRequest?: KeyguardClient.Request;
    @State protected keyguardResult!: Error;

    private title = '';
    private state = Loader.State.ERROR;
    private message = '';
    private mainActionText = '';
    private alternativeActionText = '';
    private mainActionHandlerDict: {[error: string]: (event: Event) => void} = {};
    private alternativeActionHandlerDict: {[error: string]: (event: Event) => void} = {};

    private walletId?: string;

    public async created() {
        if (!(this.keyguardResult instanceof Error)) return;
        if (this.requestSpecificErrors()) return;
        if (this.keyguardResult.message === Errors.Messages.KEY_NOT_FOUND) {
            let walletId: string;
            if ((this.request as ParsedSimpleRequest).walletId) {
                // The walletId is already in the Accounts request
                walletId = (this.request as ParsedSimpleRequest).walletId;
            } else if (this.request.kind === RequestType.CHECKOUT
                    || this.request.kind === RequestType.SIGN_MESSAGE) {
                // Accounts request was Checkout/SignMessage.
                // The walletId (keyId in the Keyguard environment) is in the keyguardRequest after picking the account
                walletId = (this.keyguardRequest as KeyguardClient.SignTransactionRequest).keyId;
            } else {
                // This really should not happen.
                // Executing this code would mean i.e. a CreateRequest fired KEY_NOT_FOUND which it does not throw
                this.$rpc.reject(this.keyguardResult);
                return;
            }
            const walletInfo = await WalletStore.Instance.get(walletId);
            if (!walletInfo) {
                this.$rpc.reject(this.keyguardResult); // return it to caller
                return;
            }
            walletInfo.keyMissing = true;
            await WalletStore.Instance.put(walletInfo);

            // Display error screen
            this.title = 'Key not found';
            this.message = 'Your key is not available in the Keyguard. What would you like to do?';
            this.mainActionText = 'Login again';
            this.alternativeActionText = 'Delete account';
            this.mainActionHandlerDict[Errors.Messages.KEY_NOT_FOUND] = this.goToImport;
            this.alternativeActionHandlerDict[Errors.Messages.KEY_NOT_FOUND] = this.logout;

            this.walletId = walletId;

            return;
        }
        // TODO more Error Handling

        this.$rpc.reject(this.keyguardResult);
    }

    /**
     * use this in derived classes in case a specific error needs special handling.
     */
    protected requestSpecificErrors(): boolean {
        return false;
    }

    private mainActionHandler(event: Event) {
        const handler = this.mainActionHandlerDict[this.keyguardResult.message];
        if (handler) handler.call(this, event);
    }

    private alternativeActionHandler(event: Event) {
        const handler = this.alternativeActionHandlerDict[this.keyguardResult.message];
        if (handler) handler.call(this, event);
    }

    private goToImport() {
        staticStore.originalRouteName = this.request.kind;
        this.$rpc.routerPush(RequestType.LOGIN);
    }

    private async logout() {
        if (this.walletId) {
            await WalletStore.Instance.remove(this.walletId);
        }
        this.$rpc.reject(new Error(ERROR_ACCOUNT_REMOVED));
    }
}
</script>
