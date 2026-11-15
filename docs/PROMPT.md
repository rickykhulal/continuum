# Cook UI release instructions

Relevant user instructions, merged from the session and cleaned of chat formatting and local
machine paths. The initial local-only stage was followed by explicit release approval.

"Run `npx skills add Leonxlnx/cook` to install the Cook skill globally."
"Verify the installation by checking `~/.codex/skills/cook` exists."
"Ensure ffmpeg and Node 18+ are available."

"$cook upgrade the UI of the Continuum app to a professional, high-end aesthetic"
"Use the current live site screenshots as the 'Before' baseline and aim for a premium, modern
dashboard aesthetic (e.g., deep space dark mode, glassmorphism, refined typography, smooth
micro-interactions)."
"Set the bar to 'professional, modern, and high-contrast' matching the existing dark theme."
"Let the Cook skill autonomously build, render stills, compare, and fix the UI until it matches
the bar. The skill will generate a cook/ folder with ROUNDS.md tracking the iterations."
"Stop before finalizing the video render. Present the stills to the user for approval."
"90-minute cap (recommended)"

"Open src/components/PetCompanion.tsx."
"Remove the click requirement."
"Add a useEffect with a setInterval that triggers every 45 seconds."
"Inside the interval, pick a random fact from a predefined array."
"Update the speech bubble state with the new fact, and automatically hide it after 10 seconds."
"Ensure the setInterval is cleared in the useEffect cleanup function to prevent memory leaks."
"Preserve the drag functionality so the user can still move her around, but she should speak
on her own without any interaction."

"Run npm run build and verify 0 TypeScript errors."
"Run npm test and verify all tests pass (245+)."
"All changes must remain local for user review."

Release approval:
"I have reviewed the local changes and the Cook comparisons. The UI upgrade, autonomous Laika
timer, and responsive navigation are officially approved."
"Do NOT render the final Cook video; the stills are sufficient."
"Commit all changes: git add ."
"git commit -m \"Final Release: Premium UI upgrade via Cook, autonomous Laika, and full responsive polish\""
"Push to GitHub: git push origin main"
"Verify that Render successfully deploys the commit and the live site at
https://continuum-6ofw.onrender.com/ is healthy."
"Give me the final GitHub commit hash and the Render deployment status."

Agent: Codex, GPT-6 family. Exact model variant, reasoning settings, plan, output token usage
and cost are **not verified** in the release evidence. Platform: local Windows.
Three Before references were captured from the user's live app; four fixed UI shots were used.
The ledger records two implementation rounds and four fresh-context visual critics. Five
subagents were listed in the session (Laika and four critics); peak concurrent activity is
**not verified**. No video render or audio exists. Design duration: the accepted 90-minute cap;
final build: 1,030 modules, 17.60-second Vite build. Full command evidence and rubric scores
are in `docs/validation.md` and `cook/ROUNDS.md`.
