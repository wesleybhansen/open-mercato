import { redirect } from 'next/navigation'

export default async function SettingsRedirect() {
  redirect('/backend/settings-simple')
}
