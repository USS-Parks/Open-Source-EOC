# Timed Onboarding

This procedure measures how long a person who has never used Open Source
EOC takes to install it from removable media, with no internet, and open a
first incident. No claim about how quickly the product installs or
activates should be made without its times. Run it again for any release
whose times you would quote.

No run has been recorded yet; the [result sheet](#result-sheet) below is
blank.

## People

- **The participant** has never seen or used Open Source EOC. Experience
  with WebEOC, Veoci or another system is fine; record it. Choose someone
  who would set the product up in a small EOC: at ease with Windows, and an
  administrator on the computer. Do not show them this page, the
  [rollout playbook](ROLLOUT-PLAYBOOK.md) or the
  [self-paced modules](SELF-PACED-TRAINING.md) beforehand.
- **The observer** keeps the clock and the record and does not help. When
  the participant has made no progress for five minutes, they may ask one
  question; the observer answers only that question and records it as a
  help. The clock keeps running.

## What you need

- A Windows 10 or 11 64-bit computer that has never had Open Source EOC,
  with an administrator account for the participant. Disconnect it from
  the internet: cable out and Wi-Fi off, or on a switch with no connection
  onward. Installing with no network is part of what is measured.
- A USB drive holding the setup file and its `.sha256` file, and nothing
  else.
- A printed [network host guide](NETWORK-HOST.md), which the participant
  may read.
- The participant's phone with an authenticator app already installed.
  Installing the app is not timed.
- A clock with seconds, the task card and the [result sheet](#result-sheet),
  printed.

## The task card

Print this and give it to the participant, with the jurisdiction's name
filled in:

> Install Open Source EOC from this USB drive so that other computers and
> phones in the building can use it. Make yourself its first administrator
> for ________________. Then open a new exercise incident for a severe storm,
> named "Timed onboarding", and show the observer the checklists its
> positions received.
>
> You may use the printed network host guide and anything the setup or the
> product shows you. Say aloud what you are looking for as you go.

For a one-computer install instead of a network host, change the first
sentence to "Install Open Source EOC on this computer." and record which
the run used.

## Marks

The observer writes the clock time at each mark. The clock runs through
everything, including reading, waiting and warnings.

| Mark | When |
|---|---|
| M0 | The participant opens the USB drive's folder |
| M1 | The setup program's first page shows |
| M2 | The window that asks for the first administrator shows (a network host's setup window, or a one-computer install's first start) |
| M3 | That window ends: a host shows its `HOST_ADDRESS` lines; a one-computer install opens its sign-in page |
| M4 | A host's check ends, `HOST CHECK PASSED` or `FAILED`; for a one-computer install, write "not used" |
| M5 | The sign-in page is open |
| M6 | The console shows, after two-step sign-in is set up |
| M7 | The participant reaches **Activate an incident** |
| M8 | The participant chooses **Activate** |
| M9 | The participant shows the observer the incident's checklists |

From the marks:

- **Install:** M0 to M4 (M0 to M3 for a one-computer install).
- **First sign-in:** from the end of install to M6.
- **First activation:** M6 to M9.
- **Total:** M0 to M9.

While the clock runs, record:

- every stop longer than a minute, with what the participant was looking
  for and where they found it;
- every help, with its time, the question and the answer;
- every warning, error and failed check, as shown on screen;
- which parts of the network host guide they read.

Stop at 90 minutes, or when the participant gives up, and record the last
mark reached.

## Afterwards

Not timed. Ask, and write down the answers in the participant's words:

1. What took longest, and why?
2. Where did you expect to find something that was somewhere else?
3. What would you want in front of you the first time?
4. Would you trust this in an activation? What would it take?

Keep the filled sheet with the build's version and SHA-256. Quote the four
durations with the build they ran on, and the number of helps, whenever the
product's install or activation time is stated.

## Result sheet

The first run is Basho Parks's, with a participant he chooses. It has not
happened yet; nothing below is a result.

| Field | Entry |
|---|---|
| Date and place | |
| Build: setup file and its SHA-256 | |
| Computer: model, Windows edition and version, memory, disk | |
| Install path: network host or one computer | |
| Participant: role and systems used before (no name needed) | |
| Observer | |
| M0 to M9, clock times | |
| Install | |
| First sign-in | |
| First activation | |
| Total | |
| Last mark reached, if stopped early | |
| Stops longer than a minute | |
| Helps: time, question, answer | |
| Warnings, errors and failed checks | |
| Parts of the network host guide read | |
| Answers to the four questions | |
| Observer's notes | |
