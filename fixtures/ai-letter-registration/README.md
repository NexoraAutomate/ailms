# AI letter registration fixtures

Synthetic, non-confidential PDFs for OCR / extraction / E2E tests.

| File | Purpose |
|------|---------|
| `sample-01-typed-letter.pdf` | Baseline typed letter with `Ref: MOIT/2026/1234` |
| `sample-06-multipage.pdf` | Three pages; ref on page 1, action on page 3 |

Regenerate:

```bash
python fixtures/ai-letter-registration/scripts/generate_fixtures.py
python fixtures/ai-letter-registration/scripts/generate_fixtures.py --check
```

Additional samples (02–05, 07) are added in later steps / full fixture set.
