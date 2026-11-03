import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.118.0'

type PushTokenRow = {
  expo_push_token: string
}

type ExpoTicket = {
  status?: string
  details?: {
    error?: string
  }
  message?: string
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405)
  }

  const expectedSecret = Deno.env.get('NOTIFICATION_WEBHOOK_SECRET')
  if (!expectedSecret || request.headers.get('x-notification-webhook-secret') !== expectedSecret) {
    return jsonResponse({ error: 'Unauthorized.' }, 401)
  }

  let payload: { notification_id?: unknown }
  try {
    payload = await request.json()
  } catch {
    return jsonResponse({ error: 'Request body must be valid JSON.' }, 400)
  }

  if (
    typeof payload.notification_id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      payload.notification_id,
    )
  ) {
    return jsonResponse({ error: 'A valid notification_id is required.' }, 400)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Push delivery is missing required Supabase environment variables.')
    return jsonResponse({ error: 'Push delivery is not configured.' }, 500)
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data: notification, error: notificationError } = await supabase
    .from('notifications')
    .select('notification_id, owner_id, type, title, message, data')
    .eq('notification_id', payload.notification_id)
    .maybeSingle()

  if (notificationError) {
    console.error('Could not load notification for push delivery:', notificationError.message)
    return jsonResponse({ error: 'Could not load the notification.' }, 500)
  }
  if (!notification) {
    return jsonResponse({ error: 'Notification not found.' }, 404)
  }

  const { data: tokens, error: tokenError } = await supabase
    .from('device_push_tokens')
    .select('expo_push_token')
    .eq('owner_id', notification.owner_id)

  if (tokenError) {
    console.error('Could not load push tokens:', tokenError.message)
    return jsonResponse({ error: 'Could not load push tokens.' }, 500)
  }

  const tokenRows = (tokens ?? []) as PushTokenRow[]
  if (tokenRows.length === 0) {
    return jsonResponse({ sent: 0, message: 'No registered devices.' })
  }

  let sent = 0
  const invalidTokens: string[] = []
  for (let offset = 0; offset < tokenRows.length; offset += 100) {
    const batch = tokenRows.slice(offset, offset + 100)
    const response = await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(
        batch.map(({ expo_push_token: to }) => ({
          to,
          title: notification.title,
          body: notification.message,
          sound: 'default',
          data: {
            notification_id: notification.notification_id,
            type: notification.type,
            data: notification.data,
          },
        })),
      ),
    })

    if (!response.ok) {
      const errorBody = await response.text()
      console.error('Expo Push Service rejected a notification batch:', response.status, errorBody)
      return jsonResponse({ error: 'Expo Push Service rejected the batch.' }, 502)
    }

    const result = (await response.json()) as { data?: ExpoTicket[] | ExpoTicket }
    const tickets = Array.isArray(result.data) ? result.data : [result.data]
    for (const [index, ticket] of tickets.entries()) {
      if (ticket?.status === 'ok') {
        sent += 1
      } else if (ticket?.details?.error === 'DeviceNotRegistered') {
        const invalidToken = batch[index]?.expo_push_token
        if (invalidToken) invalidTokens.push(invalidToken)
      } else if (ticket) {
        console.error('Expo Push Service returned a failed ticket:', ticket.message ?? ticket)
      }
    }
  }

  if (invalidTokens.length > 0) {
    const { error } = await supabase
      .from('device_push_tokens')
      .delete()
      .in('expo_push_token', invalidTokens)
    if (error) {
      console.error('Could not remove expired push tokens:', error.message)
    }
  }

  return jsonResponse({ sent, expired: invalidTokens.length })
})
