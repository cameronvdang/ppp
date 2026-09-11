import { PRIVACY_DESTINATIONS } from '../privacy/destinations'
export function PrivacyTable() {
  return <table className="privacy-table">
    <caption className="sr-only">What leaves your browser</caption>
    <thead><tr><th scope="col">Destination</th><th scope="col">When</th><th scope="col">What is sent</th><th scope="col">Off by default?</th></tr></thead>
    <tbody>{PRIVACY_DESTINATIONS.map(row => <tr key={row.destination}>
      <th scope="row">{row.destination}</th><td data-label="When">{row.when}</td><td data-label="What is sent">{row.sent}</td><td data-label="Off by default?">{row.when === 'Never' ? '—' : 'Yes'}</td>
    </tr>)}</tbody>
  </table>
}
