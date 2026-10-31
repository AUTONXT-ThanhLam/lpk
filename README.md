# lpk

Claude Code plugins from one marketplace:

- [`lpk`](lpk/README.md): one coding request to a delivered, reviewed PR.
- `drawio` (`draw/`): technical diagrams as editable draw.io files.

```
/plugin marketplace add AUTONXT-ThanhLam/lpk
/plugin install lpk@lpk-dev
```

**Windows (experimental).** lpk needs Git for Windows (its `bash`) and Node 24. Process groups, locks and
junctions have Windows paths, and the whole suite runs on `windows-latest` in CI, where a red test fails
the build. Windows is proved only there, so report rough edges with the output of `lpk doctor`.

The `lpk` designer builds screens on Emil Kowalski's `apple-design` and `emil-design-eng`, read in
full before every design, plus a small kit (`lpk/skills/ui-craft`) for what they leave open: the
face of the product, a full first screen, depth, type and a look-and-fix loop. Frequent actions do
not move; what a person touches responds on press. `lpk:ui-reviewer` judges by the same rules.

`lpk verify` runs the checks of a run in two tiers. The fast checks (`--verify`) gate every commit.
The slow checks that CI also runs, such as a database suite, are final (`--verify-final`): `lpk verify`
skips them, `lpk verify --final` runs them on the frozen review tree, and delivery needs both tiers
green on the tree it delivers.

See [lpk/README.md](lpk/README.md) for what lpk needs and how to use it.
