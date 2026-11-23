# Trial game and points

Implemented: server-selected question by difficulty, shuffled choices, small hint, explanation and direct source link; multiple choice and true/false. Twelve internal source-linked trial questions. A correct answer inserts an attempt and an `INSERT OR IGNORE` ledger credit atomically. Unique `(user_id,question_id,kind)` means 10 first correct answers on 10 unique questions equal 10 trial points; replays do not add credits. The balance is computed from the ledger, not user-controlled client state.

The bank has not passed scholarly human approval and is not public curriculum. Add reviewed question-bank administration, matching/ordering, daily/weekly/monthly challenges, abuse throttles, session state and tests before launch. No points on worship or religiosity; coins are neither cash nor crypto.
