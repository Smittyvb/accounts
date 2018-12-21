<template>
    <div class="container pad-bottom">
        <SmallPage>
            <Loader state="success">
                <template slot="success">
                    <div class="success nq-icon"></div>
                    <h1 class="title nq-h1">Account backed up!</h1>
                </template>
            </Loader>
        </SmallPage>
    </div>
</template>

<script lang="ts">
import { Component, Vue } from 'vue-property-decorator';
import { SmallPage } from '@nimiq/vue-components';
import { ExportResult } from '@/lib/RequestTypes';
import { State, Getter } from 'vuex-class';
import { Static } from '@/lib/StaticStore';
import Loader from '@/components/Loader.vue';
import { WalletInfo } from '@/lib/WalletInfo';
import { WalletStore } from '@/lib/WalletStore';

@Component({components: {SmallPage, Loader}})
export default class ExportSuccess extends Vue {
    @Static private keyguardRequest!: KeyguardRequest.SimpleRequest;
    @State private keyguardResult!: KeyguardRequest.ExportResult;

    @Getter private findWallet!: (id: string) => WalletInfo | undefined;

    private async mounted() {
        const wallet = this.findWallet(this.keyguardRequest.keyId);
        if (!wallet) {
            this.$rpc.reject(new Error('walletId not found'));
            return;
        }

        wallet.hasFile = this.keyguardResult.hasFile;
        wallet.hasWords = this.keyguardResult.hasWords;

        await WalletStore.Instance.put(wallet);

        setTimeout(() => this.$rpc.resolve(this.keyguardResult), Loader.SUCCESS_REDIRECT_DELAY);
    }
}
</script>

<style scope>
    .small-page {
        height: 70rem;
    }
</style>
