import React, { useEffect, useState } from 'react'
import { getConfig } from '../services/productService'

export default function Dashboard() {
  const [config, setConfig] = useState<any>(null)

  useEffect(() => {
    getConfig().then((r) => setConfig(r.data)).catch(() => setConfig(null))
  }, [])

  return (
    <div>
      <h2>Dashboard</h2>
      <pre>{JSON.stringify(config, null, 2)}</pre>
    </div>
  )
}
