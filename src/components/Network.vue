<template>
    <div class="network loading nq-blue-bg" :class="alwaysVisible || (visible && !consensusEstablished) ? '' : 'hidden'">
        <div class="loading-animation"></div>
        <div class="loading-status nq-text-s">{{ status }}</div>
    </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';
import { SignTransactionResult } from '../lib/RequestTypes';
import {
    SignTransactionRequest as KSignTransactionRequest,
    SignTransactionResult as KSignTransactionResult,
} from '@nimiq/keyguard-client';
// import { NanoApi, DetailedPlainTransaction } from '@nimiq/network-client';
import { NanoApi, Events, DetailedPlainTransaction } from '@nimiq/nano-api';
import Config from 'config';
import { NETWORK_TEST, NETWORK_DEV, NETWORK_MAIN, ERROR_INVALID_NETWORK } from '../lib/Constants';

@Component
export default class Network extends Vue {
    @Prop(Boolean) private visible?: boolean;
    @Prop(Boolean) private alwaysVisible?: boolean;
    @Prop(String) private message?: string;

    private consensusEstablished: boolean = false;
    private boundListeners: Array<[Events, (...args: any[]) => void]> = [];

    public async connect() {
        const client = await this._getNanoApi();
    }

    // Uint8Arrays cannot be stored in SessionStorage, thus the stored request has arrays instead and is
    // thus not exactly the type KSignTransactionRequest. Thus all potential Uint8Arrays are converted
    // into Nimiq.SerialBuffers (sender, recipient, data).
    public async prepareTx(
        keyguardRequest: KSignTransactionRequest,
        keyguardResult: KSignTransactionResult,
    ): Promise<Nimiq.Transaction> {
        await this._loadNimiq();

        let tx: Nimiq.Transaction;

        if (
            (keyguardRequest.data && keyguardRequest.data.length > 0)
            || keyguardRequest.senderType !== Nimiq.Account.Type.BASIC
            || keyguardRequest.recipientType !== Nimiq.Account.Type.BASIC
        ) {
            tx = new Nimiq.ExtendedTransaction(
                new Nimiq.Address(new Nimiq.SerialBuffer(keyguardRequest.sender)),
                keyguardRequest.senderType || Nimiq.Account.Type.BASIC,
                new Nimiq.Address(new Nimiq.SerialBuffer(keyguardRequest.recipient)),
                keyguardRequest.recipientType || Nimiq.Account.Type.BASIC,
                keyguardRequest.value,
                keyguardRequest.fee,
                keyguardRequest.validityStartHeight,
                keyguardRequest.flags || 0,
                new Nimiq.SerialBuffer(keyguardRequest.data || 0),
                Nimiq.SignatureProof.singleSig(
                    new Nimiq.PublicKey(keyguardResult.publicKey),
                    new Nimiq.Signature(keyguardResult.signature),
                ).serialize(),
            );
        } else {
            tx = new Nimiq.BasicTransaction(
                new Nimiq.PublicKey(keyguardResult.publicKey),
                new Nimiq.Address(new Nimiq.SerialBuffer(keyguardRequest.recipient)),
                keyguardRequest.value,
                keyguardRequest.fee,
                keyguardRequest.validityStartHeight,
                new Nimiq.Signature(keyguardResult.signature),
            );
        }

        return tx;
    }

    /**
     * The result of this method can also be used as a PlainTransaction
     * for all relevant nano-api methods.
     */
    public makeSignTransactionResult(tx: Nimiq.Transaction): SignTransactionResult {
        const proof = Nimiq.SignatureProof.unserialize(new Nimiq.SerialBuffer(tx.proof));

        const result: SignTransactionResult = {
            serializedTx: tx.serialize(),

            sender: tx.sender.toUserFriendlyAddress(),
            senderType: tx.senderType,
            senderPubKey: proof.publicKey.serialize(),

            recipient: tx.recipient.toUserFriendlyAddress(),
            recipientType: tx.recipientType,

            value: tx.value,
            fee: tx.fee,
            validityStartHeight: tx.validityStartHeight,

            signature: proof.signature.serialize(),

            extraData: tx.data,
            flags: tx.flags,
            networkId: tx.networkId,

            hash: tx.hash().toBase64(),
        };

        return result;
    }

    /**
     * Relays the transaction to the network and only resolves when the network
     * fires its 'transaction-relayed' event for that transaction.
     */
    public async sendToNetwork(tx: Nimiq.Transaction): Promise<SignTransactionResult> {
        const txObj = this.makeSignTransactionResult(tx);
        const client = await this._getNanoApi();

        const txObjToSend = Object.assign({}, txObj, {
            value: Nimiq.Policy.satoshisToCoins(txObj.value),
            fee: Nimiq.Policy.satoshisToCoins(txObj.fee),
        });
        client.relayTransaction(txObjToSend);

        return new Promise<SignTransactionResult>((resolve, reject) => {
            this.$once('transaction-relayed', (txInfo: any) => {
                if (txInfo.hash === txObj.hash) resolve(txObj);
            });
        });
    }

    public async subscribe(addresses: string[]) {
        const client = await this._getNanoApi();
        return client.subscribe(addresses);
    }

    public async getBalances(addresses: string[]): Promise<Map<string, number>> {
        const client = await this._getNanoApi();
        return client.getBalance(addresses);
    }

    private created() {
        this.$on('consensus-established', () => this.consensusEstablished = true);
        this.$on('consensus-lost', () => this.consensusEstablished = false);
    }

    private destroyed() {
        if (!NanoApi.hasInstance()) return;
        for (const [event, listener] of this.boundListeners) {
            NanoApi.Instance.off(event, listener);
        }
    }

    private async _getNanoApi(): Promise<NanoApi> {
        if (!NanoApi.hasInstance) {
            const config = { CDN: Config.CDN, network: Config.network, usePico: true };
            const client = NanoApi.createInstance(config);
            await client.init();
        }

        if (this.boundListeners.length === 0) {
            this._registerNetworkListener(Events.API_READY,
                () => this.$emit(Events.API_READY));
            this._registerNetworkListener(Events.API_FAIL,
                (e: Error) => this.$emit(Events.API_FAIL, e));
            this._registerNetworkListener(Events.CONSENSUS_SYNCING,
                () => this.$emit(Events.CONSENSUS_SYNCING));
            this._registerNetworkListener(Events.CONSENSUS_ESTABLISHED,
                () => this.$emit(Events.CONSENSUS_ESTABLISHED));
            this._registerNetworkListener(Events.CONSENSUS_LOST,
                () => this.$emit(Events.CONSENSUS_LOST));
            this._registerNetworkListener(Events.PEERS_CHANGED,
                (count: number) => this.$emit(Events.PEERS_CHANGED, count));
            this._registerNetworkListener(Events.BALANCES_CHANGED,
                (balances: Map<string, number>) => this.$emit(Events.BALANCES_CHANGED, balances));
            this._registerNetworkListener(Events.TRANSACTION_PENDING,
                (txInfo: Partial<DetailedPlainTransaction>) => this.$emit(Events.TRANSACTION_PENDING, txInfo));
            this._registerNetworkListener(Events.TRANSACTION_EXPIRED,
                (hash: string) => this.$emit(Events.TRANSACTION_EXPIRED, hash));
            this._registerNetworkListener(Events.TRANSACTION_MINED,
                (txInfo: DetailedPlainTransaction) => this.$emit(Events.TRANSACTION_MINED, txInfo));
            this._registerNetworkListener(Events.TRANSACTION_RELAYED,
                (txInfo: Partial<DetailedPlainTransaction>) => this.$emit(Events.TRANSACTION_RELAYED, txInfo));
            this._registerNetworkListener(Events.HEAD_CHANGE,
                (headInfo: {height: number, globalHashrate: number}) =>
                    this.$emit(Events.HEAD_CHANGE, headInfo));

            this._fireInitialEvents();
        }

        return NanoApi.Instance;
    }

    private _registerNetworkListener(event: Events, listener: (...args: any[]) => void) {
        if (!NanoApi.hasInstance()) console.warn('Using default instance with default endpoint.');
        NanoApi.Instance.on(event, listener);
        this.boundListeners.push([event, listener]);
    }

    private _fireInitialEvents() {
        if (!NanoApi.Instance) return;

        const networkClient = NanoApi.Instance;

        if (networkClient.apiLoadingState === 'ready') this.$emit(Events.API_READY);
        else if (networkClient.apiLoadingState === 'failed') this.$emit(Events.API_FAIL);

        if (networkClient.consensusState === 'syncing') this.$emit(Events.CONSENSUS_SYNCING);
        else if (networkClient.consensusState === 'established') this.$emit(Events.CONSENSUS_ESTABLISHED);
        else if (networkClient.consensusState === 'lost') this.$emit(Events.CONSENSUS_LOST);

        if (networkClient.peerCount !== 0) this.$emit(Events.PEERS_CHANGED, networkClient.peerCount);

        if (networkClient.balances.size !== 0) this.$emit(Events.BALANCES_CHANGED, networkClient.balances);

        for (const tx of networkClient.pendingTransactions) this.$emit(Events.TRANSACTION_PENDING, tx);
        for (const txHash of networkClient.expiredTransactions) this.$emit(Events.TRANSACTION_EXPIRED, txHash);
        for (const tx of networkClient.minedTransactions) this.$emit(Events.TRANSACTION_MINED, tx);
        for (const tx of networkClient.relayedTransactions) this.$emit(Events.TRANSACTION_RELAYED, tx);

        if (networkClient.headInfo.height !== 0) this.$emit(Events.HEAD_CHANGE, networkClient.headInfo);
    }

    private async _loadNimiq() {
        await Nimiq.WasmHelper.doImportBrowser();
        let genesisConfigInitialized = true;
        try {
            Nimiq.GenesisConfig.NETWORK_ID; // tslint:disable-line:no-unused-expression
        } catch (e) {
            genesisConfigInitialized = false;
        }
        if (!genesisConfigInitialized) {
            switch (Config.network) {
                case NETWORK_TEST:
                    Nimiq.GenesisConfig.test();
                    break;
                case NETWORK_MAIN:
                    Nimiq.GenesisConfig.main();
                    break;
                case NETWORK_DEV:
                    Nimiq.GenesisConfig.dev();
                    break;
                default:
                    throw new Error(ERROR_INVALID_NETWORK);
            }
        }
    }

    private get status(): string {
        return this.message || 'Establishing consensus';
    }
}
</script>

<style scoped>
    .network {
        width: 100%;
        height: 20rem;
        border-radius: 0.5rem;
        flex-shrink: 0;
        padding: 3rem;
        box-sizing: border-box;
    }

    .network.hidden {
        display: none;
    }

    .loading {
        display: flex;
        flex-direction: column;
        align-items: center;
    }

    .loading-status {
        margin-top: 2rem;
        opacity: 0.7;
    }

    .loading-animation {
        opacity: 1;
        background-image: url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCA2NCA2NCIgd2lkdGg9IjY0IiBoZWlnaHQ9IjY0Ij48c3R5bGU+QGtleWZyYW1lcyBkYXNoLWFuaW1hdGlvbiB7IHRvIHsgdHJhbnNmb3JtOiByb3RhdGUoMjQwZGVnKSB0cmFuc2xhdGVaKDApOyB9IH0gI2NpcmNsZSB7IGFuaW1hdGlvbjogM3MgZGFzaC1hbmltYXRpb24gaW5maW5pdGUgbGluZWFyOyB0cmFuc2Zvcm06IHJvdGF0ZSgtMTIwZGVnKSB0cmFuc2xhdGVaKDApOyB0cmFuc2Zvcm0tb3JpZ2luOiBjZW50ZXI7IH08L3N0eWxlPjxkZWZzPjxjbGlwUGF0aCBpZD0iaGV4Q2xpcCI+PHBhdGggY2xpcC1ydWxlPSJldmVub2RkIiBkPSJNMTYgNC4yOWgzMkw2NCAzMiA0OCA1OS43MUgxNkwwIDMyem00LjYyIDhoMjIuNzZMNTQuNzYgMzIgNDMuMzggNTEuNzFIMjAuNjJMOS4yNCAzMnoiLz48L2NsaXBQYXRoPjwvZGVmcz48cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik0xNiA0LjI5aDMyTDY0IDMyIDQ4IDU5LjcxSDE2TDAgMzJ6bTQuNjIgOGgyMi43Nkw1NC43NiAzMiA0My4zOCA1MS43MUgyMC42Mkw5LjI0IDMyeiIgZmlsbD0iI2ZmZiIgb3BhY2l0eT0iLjIiLz48ZyBjbGlwLXBhdGg9InVybCgjaGV4Q2xpcCkiPjxjaXJjbGUgaWQ9ImNpcmNsZSIgY3g9IjMyIiBjeT0iMzIiIHI9IjE2IiBmaWxsPSJub25lIiBzdHJva2Utd2lkdGg9IjMyIiBzdHJva2U9IiNGNkFFMkQiIHN0cm9rZS1kYXNoYXJyYXk9IjE2LjY2NiA4NC42NjYiLz48L2c+PC9zdmc+');
        background-repeat: no-repeat;
        background-position: center;
        background-size: 100%;
        z-index: 1;
        display: block;
        height: 10rem;
        width: 10rem;
    }
</style>
