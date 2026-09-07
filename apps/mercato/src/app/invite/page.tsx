export default function RetiredLocalInvitePage() {
  return (
    <main className="min-h-screen bg-background flex items-center justify-center p-6">
      <section className="w-full max-w-md rounded-xl border bg-card p-6 text-center shadow-sm">
        <h1 className="text-xl font-semibold">Team invitations have moved</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Noli now manages membership and roles for every app from one team
          page.
        </p>
        <a
          href="https://app.noliai.com/team"
          className="mt-6 inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          Open Noli team management
        </a>
      </section>
    </main>
  )
}
