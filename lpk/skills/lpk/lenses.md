# The lenses a run owes

`lpk reviews owed` lists the lenses the run at hand owes; by lane and bar they are:

| Change | Quick lane | Full lane |
| --- | --- | --- |
| increment bar | Code reviewer, Bug hunter | Code reviewer, Bug hunter |
| production bar | Code reviewer, Bug hunter | Tech lead, Code reviewer, Bug hunter, Claims, Prover |
| documentation only | Tech lead, Claims | Tech lead, Claims |

The floor adds lenses to any row: Security for an auth, credential, migration or `SENSITIVE.md` fact;
Regression for a changed route, export or schema line; the Mutant when tests are in the diff. The lane
you declared does not shrink the set: a change the floor calls full owes the Full lane's set at
either bar, and the Quick lane's two lenses are owed only while the floor calls the change small. A documentation change that touches a
sensitive path is not documentation only.
