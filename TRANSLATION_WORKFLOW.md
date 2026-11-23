# Translation workflow

Target locales: ar, en, ur, id, ms, bn, tr, hi, zh-CN, fr. Arabic and Urdu use RTL. The current UI exposes all 10 choices but keeps Arabic text with a clear pending notice for untranslated locales; this is architecture and discovery, not 10 completed translations.

UI strings and scholarly content are separate. Quran Arabic is never sent to a machine translator; translations of meanings need named edition, rights and review. Hadith translations require edition and scholarly review. Record translator, source, reviewer, status and revision per locale; publish each separately. Add locale URLs and hreflang once reviewed text actually exists.
