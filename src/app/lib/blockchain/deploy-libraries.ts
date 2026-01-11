import { isAddress } from "ethers";
import deployedContracts from "../../../deployed-contracts.json";

type DeployedContracts = {
    addresses?: Record<string, string>;
};

/**
 * Récupère les adresses des libraries déployées depuis deployed-contracts.json.
 * 
 * @param _sponsorAddr L'adresse du sponsor (non utilisée, conservée pour compatibilité)
 * @returns Une Map avec les noms des libraries et leurs adresses déployées
 */
export async function deployLibraries(
    _sponsorAddr: string
): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const addresses = (deployedContracts as DeployedContracts).addresses || {};

    for (const [name, address] of Object.entries(addresses)) {
        if (typeof address === "string" && isAddress(address)) {
            result.set(name, address);
        }
    }

    if (result.size === 0) {
        throw new Error(
            "No deployed library addresses found. Run `npx tsx scripts/deployCompleteStack.ts --network localhost` and rebuild the app."
        );
    }

    return result;
}
