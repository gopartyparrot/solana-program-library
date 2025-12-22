# Changelog

## 2025-12-17

### Fixed

- Handle undelegated (force-destaked) validator stakes in `UpdateValidatorListBalance`

  **Problem:** Validators in the stake pool could become undelegated (deactivated) externally
  (e.g., during cluster restarts or by the validator operator). When this happened, their
  delegated stakes transitioned to `Initialized` state, causing them to become orphaned:

  | Instruction | Issue |
  |-------------|-------|
  | `decrease-validator-stake` | Cannot deactivate already undelegated stake |
  | `remove-validator` | Requires stake balance = ~1 SOL minimum, but these have more |
  | `withdraw-stake` | Requires `Stake` state, not `Initialized` |
  | `update` | Just logged "ignoring" for undelegated validator stakes |

  **Solution:** Modified `process_update_validator_list_balance` to detect `Initialized`
  validator stakes that are still controlled by the pool (matching authorities and lockup).
  When found:
  1. Merge the undelegated stake into the reserve (recovering all lamports)
  2. Set validator status to `DeactivatingTransient` (if transient stake exists) or
     `ReadyForRemoval` (if no transient stake)

  This matches the behavior in the latest official stake-pool program at
  https://github.com/solana-program/stake-pool

### Changed

- Added `stake_is_usable_by_pool()` helper function to check if a stake account's
  authorities and lockup match the pool's expected values
