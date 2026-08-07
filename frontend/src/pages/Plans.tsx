import React, { useState } from 'react'
import { createPlan } from '../services/productService'

export default function Plans() {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [price, setPrice] = useState(0)

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await createPlan({ code, name, price, currency: 'USD' })
      alert('Plan created')
    } catch (err: any) {
      alert(err?.response?.data?.detail || 'Error')
    }
  }

  return (
    <div>
      <h2>Plans</h2>
      <form onSubmit={handleCreate}>
        <div>
          <label>Code</label>
          <input value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div>
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label>Price</label>
          <input type="number" value={price} onChange={(e) => setPrice(Number(e.target.value))} />
        </div>
        <button type="submit">Create Plan</button>
      </form>
    </div>
  )
}
