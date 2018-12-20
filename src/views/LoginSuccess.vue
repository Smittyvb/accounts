<template>
    <div class="container pad-bottom">
        <SmallPage>
            <Loader :title="title" :state="state" :status="status" :lightBlue="true"/>
        </SmallPage>
    </div>
</template>

<script lang="ts">
import { Component, Emit, Vue } from 'vue-property-decorator';
import { ParsedLoginRequest, OnboardingResult, RequestType } from '../lib/RequestTypes';
import { State } from 'vuex-class';
import { WalletInfo, WalletType } from '../lib/WalletInfo';
import { WalletStore } from '@/lib/WalletStore';
import { Static } from '@/lib/StaticStore';
import { SmallPage } from '@nimiq/vue-components';
import Loader from '@/components/Loader.vue';
import WalletInfoCollector from '@/lib/WalletInfoCollector';

@Component({components: {Loader, SmallPage}})
export default class LoginSuccess extends Vue {
    @Static private request!: ParsedLoginRequest;
    @State private keyguardResult!: KeyguardRequest.ImportResult;

    private walletInfo: WalletInfo | null = null;
    private retrievalFailed: boolean = false;
    private state: Loader.State = Loader.State.LOADING;
    private title: string = 'Collecting your addresses';

    private async mounted() {
        // The Keyguard always returns (at least) one derived Address,
        const keyguardResultAccounts = this.keyguardResult.addresses.map((addressObj) => ({
            address: new Nimiq.Address(addressObj.address).toUserFriendlyAddress(),
            path: addressObj.keyPath,
        }));

        let tryCount = 0;
        while (true) {
            try {
                tryCount += 1;
                this.walletInfo = await WalletInfoCollector.collectWalletInfo(
                    this.keyguardResult.keyType,
                    this.keyguardResult.keyId,
                    keyguardResultAccounts,
                );

                this.walletInfo.hasFile = this.keyguardResult.hasFile;
                this.walletInfo.hasWords = this.keyguardResult.hasWords;

                await WalletStore.Instance.put(this.walletInfo!);

                this.retrievalFailed = false;
                this.done();
                break;
            } catch (e) {
                this.retrievalFailed = true;
                if (tryCount >= 5) throw e;
            }
        }
    }

    @Emit()
    private done() {
        if (!this.walletInfo) throw new Error('WalletInfo not ready.');
        const result: OnboardingResult = {
            walletId: this.walletInfo.id,
            label: this.walletInfo.label,
            type: this.walletInfo.type,
            hasFile: this.walletInfo.hasFile,
            hasWords: this.walletInfo.hasWords,
            accounts: Array.from(this.walletInfo.accounts.values()).map((addressInfo) => ({
                address: addressInfo.userFriendlyAddress,
                label: addressInfo.label,
            })),
        };

        this.title = 'Your account is ready.';
        this.state = Loader.State.SUCCESS;

        setTimeout(() => this.$rpc.resolve(result), Loader.SUCCESS_REDIRECT_DELAY);
    }

    private get status() {
        return !this.retrievalFailed ? 'Connecting to Nimiq...' : 'Account retrieval failed. Retrying...';
    }
}
</script>
