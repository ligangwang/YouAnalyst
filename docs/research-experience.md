# Research and following experience

Company relationships show compact cards, four per category by default. Product filters (EPYC, Instinct/MI and Helios) use affirmative source scopes; negated limitations do not become product matches. Planned activity stays visible with details collapsed. Each card offers company navigation, independent following and expandable evidence. A relationship anchor reveals hidden cards and opens the matching evidence.

Registration resolves the follow target through the public knowledge graph, with a ticker or plain-language fallback. The canonical identifier remains in the continuation URL for persistence, but is not used as the visible company name. Following has Companies and Updates views. Signed-out visitors see clearly labelled examples drawn from real public AMD, NVIDIA and Micron records, without fetching private updates or pretending those companies have been followed.

When WebGL initialization, context loss or the canvas error boundary triggers the fallback, the public company directory automatically opens. Normal 3D rendering retains the existing collapsed directory behavior.

## Filing summaries

Feed and personalized filing entries use existing `insider_transactions` records matched by accession number. At most five parsed non-derivative records appear per filing; the UI explicitly identifies this as partial coverage. No new collection or historical-data rewrite is required. The reader caches bounded lookups for five minutes and retains the original filing card if enrichment fails. Live snapshot version checks prevent slower enrichment from replacing a newer snapshot.

Owner, transaction code, security, shares and transaction date come from parsed fields. USD amounts require usable value quality and are withheld for known review holds. We do not infer a purchase from the acquired/disposed flag, aggregate joint-owner rows into misleading totals, or relabel collection dates as transactions. [SEC Form 4 instructions, section 8](https://www.sec.gov/files/form4.pdf) define the transaction code labels. Current ingestion primarily covers purchase/sale records; displaying other codes depends on their presence in the parsed store.

Relationship updates retain their specific source scope and distinguish research collection/review, source publication and an explicit event date. No deployment milestone or newly occurring business event is inferred merely from a new research record.
