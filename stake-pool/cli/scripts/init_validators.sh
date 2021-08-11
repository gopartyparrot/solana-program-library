solana-keygen new --no-passphrase -s -o keys/identity_1.json
solana-keygen new --no-passphrase -s -o keys/vote_1.json
solana create-vote-account keys/vote_1.json keys/identity_1.json --commission 1


solana-keygen new --no-passphrase -s -o keys/identity_2.json
solana-keygen new --no-passphrase -s -o keys/vote_2.json
solana create-vote-account keys/vote_2.json keys/identity_2.json --commission 1



solana-keygen new --no-passphrase -o stake1.json --force
solana create-stake-account stake1.json 100
solana delegate-stake stake1.json keys/vote_1.json


solana-keygen new --no-passphrase -o stake2.json --force
solana create-stake-account stake2.json 100
solana delegate-stake s v



./spl-stake-pool create-validator-stake HMgnMVm3UnC75T9aDy2hMhRJiLKGPhc6ecj8Nq9t9icX HRkfLgwj2sieqJ51okdKHQd7u3Z9ZarjGEtBvohK9Z9S
./spl-stake-pool add-validator HMgnMVm3UnC75T9aDy2hMhRJiLKGPhc6ecj8Nq9t9icX HRkfLgwj2sieqJ51okdKHQd7u3Z9ZarjGEtBvohK9Z9S

./spl-stake-pool create-validator-stake HMgnMVm3UnC75T9aDy2hMhRJiLKGPhc6ecj8Nq9t9icX 7BaMdxQwGzsiDUgPJW9deQFNhmErrTpetab76xF46WE5
./spl-stake-pool add-validator HMgnMVm3UnC75T9aDy2hMhRJiLKGPhc6ecj8Nq9t9icX 7BaMdxQwGzsiDUgPJW9deQFNhmErrTpetab76xF46WE5
