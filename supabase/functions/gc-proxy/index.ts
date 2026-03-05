const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
};

const GC_API_URL = 'https://api.gestaoclick.com';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const GC_ACCESS_TOKEN = Deno.env.get('GC_ACCESS_TOKEN');
  const GC_SECRET_TOKEN = Deno.env.get('GC_SECRET_TOKEN');

  if (!GC_ACCESS_TOKEN || !GC_SECRET_TOKEN) {
    return new Response(
      JSON.stringify({ error: 'GestãoClick credentials not configured' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const body = await req.json();
    const { path, method: gcMethod, payload } = body;

    if (!path) {
      return new Response(
        JSON.stringify({ error: 'Missing "path" in request body' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const targetUrl = `${GC_API_URL}${path}`;
    const httpMethod = gcMethod || 'GET';

    const gcHeaders: Record<string, string> = {
      'access-token': GC_ACCESS_TOKEN,
      'secret-access-token': GC_SECRET_TOKEN,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    const fetchOptions: RequestInit = {
      method: httpMethod,
      headers: gcHeaders,
    };

    if ((httpMethod === 'PUT' || httpMethod === 'POST') && payload) {
      fetchOptions.body = JSON.stringify(payload);
    }

    const response = await fetch(targetUrl, fetchOptions);
    const responseBody = await response.text();

    console.log(`GC API ${httpMethod} ${path} -> ${response.status}`);
    if (!response.ok) {
      console.error(`GC API error body: ${responseBody}`);
    }

    // Always return 200 to the client with the GC status embedded
    // so supabase.functions.invoke doesn't swallow the response body
    let parsedBody: Record<string, unknown>;
    try {
      parsedBody = JSON.parse(responseBody);
    } catch {
      parsedBody = { raw: responseBody };
    }

    // Use a wrapper to avoid key collisions with GC response
    const wrappedResponse = {
      _proxy: {
        gc_http_status: response.status,
        ok: response.ok,
      },
      ...parsedBody,
    };

    return new Response(
      JSON.stringify(wrappedResponse),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('GC Proxy error:', message);
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
