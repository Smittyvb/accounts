<template>
    <div class="network loading nq-blue-bg" :class="alwaysVisible || (visible && !consensusEstablished) ? '' : 'hidden'">
        <div class="loading-animation"></div>
        <div class="loading-status nq-text-s">{{ status }}</div>
    </div>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';
import { SignedTransaction } from '../lib/PublicRequestTypes';
import KeyguardClient from '@nimiq/keyguard-client';
import { NetworkClient, PlainTransaction, DetailedPlainTransaction } from '@nimiq/network-client';
import Config from 'config';
import {
    NETWORK_TEST,
    NETWORK_DEV,
    NETWORK_MAIN,
    ERROR_INVALID_NETWORK,
    CONTRACT_DEFAULT_LABEL_VESTING,
} from '../lib/Constants';
import { VestingContractInfo } from '../lib/ContractInfo';

@Component
class Network extends Vue {
    @Prop(Boolean) private visible?: boolean;
    @Prop(Boolean) private alwaysVisible?: boolean;
    @Prop(String) private message?: string;

    private consensusEstablished: boolean = false;
    private boundListeners: Array<[NetworkClient.Events, (...args: any[]) => void]> = [];

    public async connect() {
        // Load network iframe
        const client = await this._getNetworkClient();
    }

    public async connectPico(addresses: string[]): Promise<Map<string, number>> {
        // Load network iframe
        const client = await this._getNetworkClient();
        client.disconnect();

        // Connect
        return client.connectPico(addresses);
    }

    public async disconnect() {
        if (!NetworkClient.hasInstance()) return;
        return NetworkClient.Instance.disconnect();
    }

    public async prepareTx(
        keyguardRequest: KeyguardClient.SignTransactionRequest,
        keyguardResult: KeyguardClient.SignTransactionResult,
    ): Promise<Nimiq.Transaction> {
        await this._loadNimiq();

        let tx: Nimiq.Transaction;

        if (
            (keyguardRequest.data && keyguardRequest.data.length > 0)
            || keyguardRequest.senderType // this condition is truthy when type is 1 or 2
            || keyguardRequest.recipientType // this condition is truthy when type is 1 or 2
        ) {
            tx = new Nimiq.ExtendedTransaction(
                new Nimiq.Address(keyguardRequest.sender),
                keyguardRequest.senderType || Nimiq.Account.Type.BASIC,
                new Nimiq.Address(keyguardRequest.recipient),
                keyguardRequest.recipientType || Nimiq.Account.Type.BASIC,
                keyguardRequest.value,
                keyguardRequest.fee,
                keyguardRequest.validityStartHeight,
                keyguardRequest.flags || 0,
                keyguardRequest.data || new Uint8Array(0),
                Nimiq.SignatureProof.singleSig(
                    new Nimiq.PublicKey(keyguardResult.publicKey),
                    new Nimiq.Signature(keyguardResult.signature),
                ).serialize(),
            );
        } else {
            tx = new Nimiq.BasicTransaction(
                new Nimiq.PublicKey(keyguardResult.publicKey),
                new Nimiq.Address(keyguardRequest.recipient),
                keyguardRequest.value,
                keyguardRequest.fee,
                keyguardRequest.validityStartHeight,
                new Nimiq.Signature(keyguardResult.signature),
            );
        }

        return tx;
    }

    public makeSignTransactionResult(tx: Nimiq.Transaction): SignedTransaction {
        const proof = Nimiq.SignatureProof.unserialize(new Nimiq.SerialBuffer(tx.proof));

        const result: SignedTransaction = {
            serializedTx: Nimiq.BufferUtils.toHex(tx.serialize()),
            hash: tx.hash().toHex(),

            raw: {
                signerPublicKey: proof.publicKey.serialize(),
                signature: proof.signature.serialize(),

                sender: tx.sender.toUserFriendlyAddress(),
                senderType: tx.senderType,

                recipient: tx.recipient.toUserFriendlyAddress(),
                recipientType: tx.recipientType,

                value: tx.value,
                fee: tx.fee,
                validityStartHeight: tx.validityStartHeight,

                extraData: tx.data,
                flags: tx.flags,
                networkId: tx.networkId,
            },
        };

        return result;
    }

    /**
     * Relays the transaction to the network and only resolves when the network
     * fires its 'transaction-relayed' event for that transaction.
     */
    public async sendToNetwork(tx: Nimiq.Transaction): Promise<SignedTransaction> {
        const signedTx = this.makeSignTransactionResult(tx);
        const client = await this._getNetworkClient();

        const txObjToSend = Object.assign({}, signedTx.raw, {
            senderPubKey: signedTx.raw.signerPublicKey,
            value: Nimiq.Policy.satoshisToCoins(signedTx.raw.value),
            fee: Nimiq.Policy.satoshisToCoins(signedTx.raw.fee),
        });
        client.relayTransaction(txObjToSend);

        return new Promise<SignedTransaction>((resolve, reject) => {
            const base64Hash = Nimiq.BufferUtils.toBase64(Nimiq.BufferUtils.fromHex(signedTx.hash));
            this.$once('transaction-relayed', (txInfo: any) => {
                if (txInfo.hash === base64Hash) resolve(signedTx);
            });
        });
    }

    public async getBalances(addresses: string[]): Promise<Map<string, number>> {
        const client = await this._getNetworkClient();
        return client.getBalance(addresses);
    }

    public async requestTransactionReceipts(address: string): Promise<Nimiq.TransactionReceipt[]> {
        const client = await this._getNetworkClient();
        return client.requestTransactionReceipts(address);
    }

    public async getGenesisVestingContracts(): Promise<VestingContractInfo[]> {
        const client = await this._getNetworkClient();
        const contracts = await client.getGenesisVestingContracts();

        return contracts.map((contract) => new VestingContractInfo(
            CONTRACT_DEFAULT_LABEL_VESTING,
            Nimiq.Address.fromUserFriendlyAddress(contract.address),
            Nimiq.Address.fromUserFriendlyAddress(contract.owner),
            contract.start,
            Nimiq.Policy.coinsToSatoshis(contract.stepAmount),
            contract.stepBlocks,
            Nimiq.Policy.coinsToSatoshis(contract.totalAmount),
        ));
    }

    private created() {
        this.$on('consensus-established', () => this.consensusEstablished = true);
        this.$on('consensus-lost', () => this.consensusEstablished = false);
    }

    private destroyed() {
        if (!NetworkClient.hasInstance()) return;
        for (const [event, listener] of this.boundListeners) {
            NetworkClient.Instance.off(event, listener);
        }
    }

    private async _getNetworkClient(): Promise<NetworkClient> {
        if (!NetworkClient.hasInstance()) {
            const networkClient = NetworkClient.createInstance(Config.networkEndpoint);
            await networkClient.init();
        }

        if (this.boundListeners.length === 0) {
            this._registerNetworkListener(NetworkClient.Events.API_READY,
                () => this.$emit(Network.Events.API_READY));
            this._registerNetworkListener(NetworkClient.Events.API_FAIL,
                (e: Error) => this.$emit(Network.Events.API_FAIL, e));
            this._registerNetworkListener(NetworkClient.Events.CONSENSUS_SYNCING,
                () => this.$emit(Network.Events.CONSENSUS_SYNCING));
            this._registerNetworkListener(NetworkClient.Events.CONSENSUS_ESTABLISHED,
                () => this.$emit(Network.Events.CONSENSUS_ESTABLISHED));
            this._registerNetworkListener(NetworkClient.Events.CONSENSUS_LOST,
                () => this.$emit(Network.Events.CONSENSUS_LOST));
            this._registerNetworkListener(NetworkClient.Events.PEERS_CHANGED,
                (count: number) => this.$emit(Network.Events.PEERS_CHANGED, count));
            this._registerNetworkListener(NetworkClient.Events.BALANCES_CHANGED,
                (balances: Map<string, number>) => this.$emit(Network.Events.BALANCES_CHANGED, balances));
            this._registerNetworkListener(NetworkClient.Events.TRANSACTION_PENDING,
                (txInfo: Partial<DetailedPlainTransaction>) => this.$emit(Network.Events.TRANSACTION_PENDING, txInfo));
            this._registerNetworkListener(NetworkClient.Events.TRANSACTION_EXPIRED,
                (hash: string) => this.$emit(Network.Events.TRANSACTION_EXPIRED, hash));
            this._registerNetworkListener(NetworkClient.Events.TRANSACTION_MINED,
                (txInfo: DetailedPlainTransaction) => this.$emit(Network.Events.TRANSACTION_MINED, txInfo));
            this._registerNetworkListener(NetworkClient.Events.TRANSACTION_RELAYED,
                (txInfo: Partial<DetailedPlainTransaction>) => this.$emit(Network.Events.TRANSACTION_RELAYED, txInfo));
            this._registerNetworkListener(NetworkClient.Events.HEAD_CHANGE,
                (headInfo: {height: number, globalHashrate: number}) =>
                    this.$emit(Network.Events.HEAD_CHANGE, headInfo));

            this._fireInitialEvents();
        }

        return NetworkClient.Instance;
    }

    private _registerNetworkListener(event: NetworkClient.Events, listener: (...args: any[]) => void) {
        if (!NetworkClient.hasInstance()) console.warn('Using default instance with default endpoint.');
        NetworkClient.Instance.on(event, listener);
        this.boundListeners.push([event, listener]);
    }

    private _fireInitialEvents() {
        if (!NetworkClient.hasInstance()) return;
        const networkClient = NetworkClient.Instance;
        if (networkClient.apiLoadingState === 'ready') this.$emit(Network.Events.API_READY);
        else if (networkClient.apiLoadingState === 'failed') this.$emit(Network.Events.API_FAIL);

        if (networkClient.consensusState === 'syncing') this.$emit(Network.Events.CONSENSUS_SYNCING);
        else if (networkClient.consensusState === 'established') this.$emit(Network.Events.CONSENSUS_ESTABLISHED);
        else if (networkClient.consensusState === 'lost') this.$emit(Network.Events.CONSENSUS_LOST);

        if (networkClient.peerCount !== 0) this.$emit(Network.Events.PEERS_CHANGED, networkClient.peerCount);

        if (networkClient.balances.size !== 0) this.$emit(Network.Events.BALANCES_CHANGED, networkClient.balances);

        for (const tx of networkClient.pendingTransactions) this.$emit(Network.Events.TRANSACTION_PENDING, tx);
        for (const txHash of networkClient.expiredTransactions) this.$emit(Network.Events.TRANSACTION_EXPIRED, txHash);
        for (const tx of networkClient.minedTransactions) this.$emit(Network.Events.TRANSACTION_MINED, tx);
        for (const tx of networkClient.relayedTransactions) this.$emit(Network.Events.TRANSACTION_RELAYED, tx);

        if (networkClient.headInfo.height !== 0) this.$emit(Network.Events.HEAD_CHANGE, networkClient.headInfo);
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

namespace Network { // tslint:disable-line:no-namespace
    export const enum Events {
        API_READY = 'api-ready',
        API_FAIL = 'api-fail',
        CONSENSUS_SYNCING = 'consensus-syncing',
        CONSENSUS_ESTABLISHED = 'consensus-established',
        CONSENSUS_LOST = 'consensus-lost',
        PEERS_CHANGED = 'peer-count',
        BALANCES_CHANGED = 'balances',
        TRANSACTION_PENDING = 'transaction-pending',
        TRANSACTION_EXPIRED = 'transaction-expired',
        TRANSACTION_MINED = 'transaction-mined',
        TRANSACTION_RELAYED = 'transaction-relayed',
        HEAD_CHANGE = 'head-change',
    }
}

export default Network;
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
