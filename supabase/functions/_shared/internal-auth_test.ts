import { requireInternalAccess } from './internal-auth.ts'

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
  }
}

function request(token?: string): Request {
  return new Request('https://example.test/functions/v1/protected', {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  })
}

async function responseError(result: Awaited<ReturnType<typeof requireInternalAccess>>) {
  if (result.ok) throw new Error('Expected denied access')
  return { status: result.response.status, body: await result.response.json() }
}

Deno.test('le service_role exact est admis sans appel reseau', async () => {
  let calls = 0
  const result = await requireInternalAccess(request('service-secret'), {
    supabaseUrl: 'https://project.supabase.co',
    serviceRoleKey: 'service-secret',
    fetchImpl: () => {
      calls += 1
      throw new Error('unexpected fetch')
    },
  })

  assertEquals(result, {
    ok: true,
    principal: { kind: 'service_role', userId: null, role: 'service_role' },
  })
  assertEquals(calls, 0)
})

Deno.test('un utilisateur Auth avec une ligne user_roles est admis', async () => {
  const requestedUrls: string[] = []
  const result = await requireInternalAccess(request('real-user-token'), {
    supabaseUrl: 'https://project.supabase.co',
    serviceRoleKey: 'service-secret',
    fetchImpl: (input) => {
      const url = String(input)
      requestedUrls.push(url)
      if (url.includes('/auth/v1/user')) {
        return Promise.resolve(Response.json({ id: 'user-123' }))
      }
      return Promise.resolve(Response.json([{ role: 'user' }]))
    },
  })

  assertEquals(result, {
    ok: true,
    principal: { kind: 'user', userId: 'user-123', role: 'user' },
  })
  assertEquals(requestedUrls.length, 2)
  assertEquals(requestedUrls[1].includes('user_id=eq.user-123'), true)
})

// Relevé à l'audit du 2026-08-22 : la fonction vérifiait qu'un rôle EXISTE,
// jamais lequel. N'importe quelle valeur insérée dans user_roles — un rôle
// « viewer » futur, une faute de frappe — ouvrait toutes les fonctions
// internes, budgets fournisseurs compris.
Deno.test('un role hors de la liste interne est refuse, meme present en base', async () => {
  for (const roleValue of ['viewer', 'guest', 'USER', 'stagiaire']) {
    const result = await requireInternalAccess(request('real-user-token'), {
      supabaseUrl: 'https://project.supabase.co',
      serviceRoleKey: 'service-secret',
      fetchImpl: (input) => {
        const url = String(input)
        if (url.includes('/auth/v1/user')) {
          return Promise.resolve(Response.json({ id: 'user-123' }))
        }
        return Promise.resolve(Response.json([{ role: roleValue }]))
      },
    })
    const denied = await responseError(result)
    assertEquals(denied.status, 403)
  }
})

// Le compte de l'opératrice ('user') et les deux rôles d'administration sont
// la liste complète : les trois doivent passer, aucun autre.
Deno.test('les trois roles operateurs passent le mur', async () => {
  for (const roleValue of ['user', 'admin', 'super_admin']) {
    const result = await requireInternalAccess(request('real-user-token'), {
      supabaseUrl: 'https://project.supabase.co',
      serviceRoleKey: 'service-secret',
      fetchImpl: (input) => {
        const url = String(input)
        if (url.includes('/auth/v1/user')) {
          return Promise.resolve(Response.json({ id: 'user-123' }))
        }
        return Promise.resolve(Response.json([{ role: roleValue }]))
      },
    })
    assertEquals(result, {
      ok: true,
      principal: { kind: 'user', userId: 'user-123', role: roleValue },
    })
  }
})

Deno.test('un JWT qui se proclame service_role sans etre le secret exact est rejete', async () => {
  let calls = 0
  const fakeServiceJwt = 'header.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.signature'
  const result = await requireInternalAccess(request(fakeServiceJwt), {
    supabaseUrl: 'https://project.supabase.co',
    serviceRoleKey: 'service-secret',
    fetchImpl: () => {
      calls += 1
      return Promise.resolve(Response.json({ message: 'invalid token' }, { status: 401 }))
    },
  })

  assertEquals(await responseError(result), { status: 401, body: { error: 'Unauthorized' } })
  assertEquals(calls, 1)
})

Deno.test('un utilisateur Auth sans ligne user_roles est interdit', async () => {
  let calls = 0
  const result = await requireInternalAccess(request('user-without-role'), {
    supabaseUrl: 'https://project.supabase.co',
    serviceRoleKey: 'service-secret',
    fetchImpl: () => {
      calls += 1
      return Promise.resolve(calls === 1 ? Response.json({ id: 'user-123' }) : Response.json([]))
    },
  })

  assertEquals(await responseError(result), { status: 403, body: { error: 'Forbidden' } })
})

Deno.test('un appel sans bearer est rejete avant toute verification distante', async () => {
  let calls = 0
  const result = await requireInternalAccess(request(), {
    supabaseUrl: 'https://project.supabase.co',
    serviceRoleKey: 'service-secret',
    fetchImpl: () => {
      calls += 1
      throw new Error('unexpected fetch')
    },
  })

  assertEquals(await responseError(result), { status: 401, body: { error: 'Unauthorized' } })
  assertEquals(calls, 0)
})

Deno.test('une panne de verification user_roles echoue fermee', async () => {
  let calls = 0
  const result = await requireInternalAccess(request('real-user-token'), {
    supabaseUrl: 'https://project.supabase.co',
    serviceRoleKey: 'service-secret',
    fetchImpl: () => {
      calls += 1
      return Promise.resolve(
        calls === 1
          ? Response.json({ id: 'user-123' })
          : Response.json({ message: 'database unavailable' }, { status: 500 }),
      )
    },
  })

  assertEquals(await responseError(result), {
    status: 503,
    body: { error: 'Authorization verification unavailable' },
  })
})
