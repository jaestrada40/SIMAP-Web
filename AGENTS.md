<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture
- All data access goes through `src/services/api.ts` (typed, mock-backed today) so it can be swapped for the real REST API without touching pages.
- Signed-in pages live under `src/routes/_authenticated/`; auth is simulated client-side (localStorage) via `src/components/auth-context.tsx`.
- The update queue state lives in `src/components/queue-context.tsx`, mounted in the authenticated layout so only one queue runs and it survives navigation.
- Page files stay in `src/routes/` (TanStack file routing); shared UI in `src/components`, types in `src/types`.
