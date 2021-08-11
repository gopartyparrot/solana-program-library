import {Schema, serialize, deserializeUnchecked, BinaryReader} from 'borsh';
import BN from 'bn.js';
import {Struct, Enum, PublicKey} from '@solana/web3.js';

BinaryReader.prototype['readPubkey'] = function(): PublicKey {
  const buf: Buffer = this.readBuffer(32);
  return new PublicKey(buf);
}

//TODO not tested
BinaryReader.prototype['writePubkey'] = function(value: number | BN) {
  this.maybeResize();
  this.writeBuffer(Buffer.from(new BN(value).toArray('le', 32)));
}

export class Fee extends Struct {
  denominator: BN;
  numerator: BN;
}

export class Lockup extends Struct {
  unixTimestamp: BN;
  epoch: BN;
  custodian: PublicKey;
}

export class AccountType extends Enum {}

export class AccountTypeEnum extends Struct {}

export enum AccountTypeKind {
  Uninitialized = 'Uninitialized',
  StakePool = 'StakePool',
  ValidatorList = 'ValidatorList',
}

export class StakePool extends Struct {
  accountType: AccountType;
  manager: PublicKey;
  staker: PublicKey;
  stakeDepositAuthority: PublicKey;
  stakeWithdrawBumpSeed: number;
  validatorList: PublicKey;
  reserveStake: PublicKey;
  poolMint: PublicKey;
  managerFeeAccount: PublicKey;
  tokenProgramId: PublicKey;
  totalStakeLamports: BN;
  poolTokenSupply: BN;
  lastUpdateEpoch: BN;
  lockup: Lockup;
  fee: Fee;
  nextEpochFee?: Fee;
  preferredDepositValidatorVoteAddress?: PublicKey;
  preferredWithdrawValidatorVoteAddress?: PublicKey;
  stakeDepositFee: Fee;
  withdrawalFee: Fee;
  nextWithdrawalFee?: Fee;
  stakeReferralFee: number;
  solDepositAuthority?: PublicKey;
  solDepositFee: Fee;
  solReferralFee: number;
}

export class ValidatorListHeader extends Struct {
  accountType: AccountType;
  maxValidators: number;
}

export class ValidatorList extends Struct {
  header: ValidatorListHeader;
  validators: [ValidatorStakeInfo];
}
export class ValidatorStakeInfo extends Struct {
  activeStakeLamports: BN;
  transientStakeLamports: BN;
  lastUpdateEpoch: BN;
  status: StakeStatus;
  voteAccountAddress: PublicKey;
}
export class StakeStatus extends Enum {}

export class StakeStatusEnum extends Struct {}

export enum StakeStatusKind {
  Active = 'Active',
  DeactivatingTransient = 'DeactivatingTransient',
  ReadyForRemoval = 'ReadyForRemoval',
}

export function addStakePoolSchema(schema: Schema): void {
  /**
   * Borsh requires something called a Schema,
   * which is a Map (key-value pairs) that tell borsh how to deserialise the raw data
   * This function adds a new schema to an existing schema object.
   */
  schema.set(PublicKey, {
    kind: 'struct',
    fields: [['_bn', 'u256']],
  });

  schema.set(Fee, {
    kind: 'struct',
    fields: [
      ['denominator', 'u64'],
      ['numerator', 'u64'],
    ],
  });

  schema.set(Lockup, {
    kind: 'struct',
    fields: [
      ['unixTimestamp', 'u64'], //TODO it's type is i64
      ['epoch', 'u64'],
      ['custodian', 'pubkey'],
    ],
  });

  schema.set(AccountType, {
    kind: 'enum',
    field: 'enum',
    values: [
      // if the account has not been initialized, the enum will be 0
      [AccountTypeKind.Uninitialized, AccountTypeEnum],
      [AccountTypeKind.StakePool, AccountTypeEnum],
      [AccountTypeKind.ValidatorList, AccountTypeEnum],
    ],
  });

  schema.set(AccountTypeEnum, {kind: 'struct', fields: []});

  schema.set(StakePool, {
    kind: 'struct',
    fields: [
      ['accountType', AccountType],
      ['manager', 'pubkey'],
      ['staker', 'pubkey'],
      ['stakeDepositAuthority', 'pubkey'],
      ['stakeWithdrawBumpSeed', 'u8'],
      ['validatorList', 'pubkey'],
      ['reserveStake', 'pubkey'],
      ['poolMint', 'pubkey'],
      ['managerFeeAccount', 'pubkey'],
      ['tokenProgramId', 'pubkey'],
      ['totalStakeLamports', 'u64'],
      ['poolTokenSupply', 'u64'],
      ['lastUpdateEpoch', 'u64'],
      ['lockup', Lockup],
      ['fee', Fee],
      ['nextEpochFee', {kind: 'option', type: Fee}],
      [
        'preferredDepositValidatorVoteAddress',
        {kind: 'option', type: 'pubkey'},
      ],
      [
        'preferredWithdrawValidatorVoteAddress',
        {kind: 'option', type: 'pubkey'},
      ],
      ['stakeDepositFee', Fee],
      ['withdrawalFee', Fee],
      ['nextWithdrawalFee', {kind: 'option', type: Fee}],
      ['stakeReferralFee', 'u8'],
      [
        'solDepositAuthority',
        {kind: 'option', type: 'pubkey'},
      ],
      ['solDepositFee', Fee],
      ['solReferralFee', 'u8'],
    ],
  });

  schema.set(ValidatorListHeader, {
    kind: 'struct',
    fields: [
      ['accountType', AccountType],
      ['maxValidators', 'u32'],
    ],
  });

  schema.set(ValidatorList, {
    kind: 'struct',
    fields: [
      ['header', ValidatorListHeader],
      ['validators', [ValidatorStakeInfo]],
    ],
  });

  schema.set(StakeStatus, {
    kind: 'enum',
    field: 'enum',
    values: [
      [StakeStatusKind.Active, StakeStatusEnum],
      [StakeStatusKind.DeactivatingTransient, StakeStatusEnum],
      [StakeStatusKind.ReadyForRemoval, StakeStatusEnum],
    ],
  });

  schema.set(StakeStatusEnum, {kind: 'struct', fields: []});

  schema.set(ValidatorStakeInfo, {
    kind: 'struct',
    fields: [
      ['activeStakeLamports', 'u64'],
      ['transientStakeLamports', 'u64'],
      ['lastUpdateEpoch', 'u64'],
      ['status', StakeStatus],
      ['voteAccountAddress', 'pubkey'],
    ],
  });
}
