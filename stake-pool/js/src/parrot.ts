import { Connection, MemcmpFilter, StakeProgram } from "@solana/web3.js";
import * as web3 from "@solana/web3.js";

export async function getParsedStakingAccount(
  connection: Connection,
  filters: {
    stakeAuthority: web3.PublicKey | null;
    withdrawAuthority: web3.PublicKey | null;
  }
): Promise<JsonParsedNativeStakeAccount[]> {
  const ret = await getStakingAccounts(connection, filters);
  return ret.map(x => ({
    ...(x.account.data as web3.ParsedAccountData).parsed,
    publicKey: x.pubkey.toBase58(),
    lamports: x.account.lamports
  }));
}

/**
 * Return user native Solana Stake Accounts
 * @returns
 */
export async function getStakingAccounts(
  connection: Connection,
  filters: {
    stakeAuthority: web3.PublicKey | null;
    withdrawAuthority: web3.PublicKey | null;
  }
) {
  const memcmps: MemcmpFilter[] = [];
  if (filters.stakeAuthority) {
    memcmps.push({
      memcmp: {
        offset: 12, //stake authority
        bytes: filters.stakeAuthority.toBase58()
      }
    });
  }
  if (filters.withdrawAuthority) {
    memcmps.push({
      memcmp: {
        offset: 44, //withdraw authority
        bytes: filters.withdrawAuthority.toBase58()
      }
    });
  }
  const accounts = await connection.getParsedProgramAccounts(
    StakeProgram.programId,
    {
      filters: memcmps
    }
  );
  return accounts;
}


  export interface JsonParsedNativeStakeAccount {
    type: 'initialized' | 'delegated'; // for initialized type, stake should be null
    lamports: number;
    publicKey: string;
    info: {
      meta: Meta;
      stake: null | {
        creditsObserved: number;
        delegation: Delegation;
      };
    };
  }
  
  export interface Meta {
    authorized: {
      staker: string;
      withdrawer: string;
    };
    lockup: {
      custodian: string;
      epoch: number;
      unixTimestamp: number;
    };
    rentExemptReserve: string;
  }
  
  export interface Delegation {
    activationEpoch: string; //if this value is smaller than current epoch, it is active, or it is activating
    deactivationEpoch: string; //if this value is equal to current_epoch + 1, it is deactivating, or it is active
    stake: string;
    voter: string;
    warmupCooldownRate: number;
  }
  
  export enum StakePoolStatus {
    Inactive = 'Inactive',
    Active = 'Active',
    Activating = 'Activating',
    Deactivating = 'Deactivating',
    Deactivated = 'Deactivated',
    Unsupported = 'Unsupported'
  }
  