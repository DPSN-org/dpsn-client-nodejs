"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const src_1 = __importDefault(require("../src"));
(() => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const dpsn = new src_1.default("DPSN_URL", "WALLET_PYT_KEY", {
            network: 'testnet',
            wallet_chain_type: 'ethereum',
            rpcUrl: "RPC_URL",
            isMainnet: false,
            isTestnet: true
        });
        dpsn.onConnect((res) => console.log(res));
        dpsn.onError((error) => {
            console.log("[Error LOG]", error);
        });
        yield dpsn.init();
        yield dpsn.subscribe("TOPIC_HASH", (res, parsedMessage, packetdetails) => {
            console.log(parsedMessage);
        });
    }
    catch (error) {
        console.log(error);
    }
    // process.exit(0)
}))();
