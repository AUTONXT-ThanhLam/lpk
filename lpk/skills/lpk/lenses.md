# The lenses a run owes

`lpk reviews owed` lists the lenses the run at hand owes; while the floor calls the change small they are, by lane and bar:

| Change | Quick lane | Full lane |
| --- | --- | --- |
| increment bar | Code reviewer, Bug hunter | Code reviewer, Bug hunter |
| production bar | Code reviewer, Bug hunter | Tech lead, Code reviewer, Bug hunter, Claims, Prover |
| documentation only | Tech lead, Claims | Tech lead, Claims |

The floor adds lenses to any row: Security for an auth, credential, migration or `SENSITIVE.md` fact;
Regression for a changed route, export or schema line; the Mutant when tests are in the diff. Once the
floor calls the change full, it owes the Full lane's set at either bar and in either lane. A documentation change that touches a
sensitive path is not documentation only.
