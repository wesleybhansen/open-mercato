import { redirect } from 'next/navigation'

export default async function BackendIndex() {
  redirect('/backend/dashboards')
}
