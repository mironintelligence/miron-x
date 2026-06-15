// Direct Twitter client — v1.1 REST + GraphQL hybrid
// v1.1 REST for read ops (stable), GraphQL for write ops (CreateTweet)

const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

const GQL_FEATURES = {
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_enhance_cards_enabled: false,
  hidden_profile_subscriptions_enabled: true,
  subscriptions_verification_info_is_identity_verified_enabled: true,
  subscriptions_verification_info_verified_since_enabled: true,
  highlights_tweets_tab_ui_enabled: true,
  responsive_web_twitter_article_notes_tab_enabled: true,
  subscriptions_feature_can_gift_premium: true,
};

class XClient {
  constructor(cookieString) {
    if (!cookieString) throw new Error('XACTIONS_SESSION_COOKIE is not set');
    this.cookies = cookieString;
    const ct0Match = cookieString.match(/ct0=([^;]+)/);
    this.ct0 = ct0Match ? ct0Match[1].trim() : null;
    if (!this.ct0) throw new Error('ct0 not found in cookie string — format: auth_token=X; ct0=Y');
  }

  _headers(extra = {}) {
    return {
      'authorization': `Bearer ${BEARER}`,
      'cookie': this.cookies,
      'x-csrf-token': this.ct0,
      'content-type': 'application/json',
      'x-twitter-active-user': 'yes',
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-client-language': 'en',
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'referer': 'https://x.com/',
      'origin': 'https://x.com',
      ...extra,
    };
  }

  // GraphQL — for write operations (CreateTweet, FavoriteTweet)
  async _gql(queryId, opName, variables) {
    const url = `https://x.com/i/api/graphql/${queryId}/${opName}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ variables, features: GQL_FEATURES, queryId }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${opName} HTTP ${res.status}: ${text.substring(0, 300)}`);
    const data = JSON.parse(text);
    if (data?.errors?.length) throw new Error(`${opName} error: ${data.errors[0]?.message}`);
    return data;
  }

  // v1.1 REST — for read operations (search, timeline, profile) — more stable
  async _rest(path, params = {}) {
    const url = new URL(`https://api.twitter.com/1.1/${path}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const res = await fetch(url.toString(), { headers: this._headers() });
    const text = await res.text();
    if (!res.ok) throw new Error(`REST ${path} HTTP ${res.status}: ${text.substring(0, 300)}`);
    return JSON.parse(text);
  }

  // ─── TWEET ───────────────────────────────────────────────────────────────
  async sendTweet(text, options = {}) {
    const variables = {
      tweet_text: text,
      dark_request: false,
      media: { media_entities: [], possibly_sensitive: false },
      semantic_annotation_ids: [],
    };
    if (options.replyTo) {
      variables.reply = { in_reply_to_tweet_id: options.replyTo, exclude_reply_user_ids: [] };
    }
    const data = await this._gql('a1p9RWpkYKBjWv_I3WzS-A', 'CreateTweet', variables);
    const result = data?.data?.create_tweet?.tweet_results?.result;
    if (!result) throw new Error(`Tweet not posted — response: ${JSON.stringify(data).substring(0, 200)}`);
    const id = result?.rest_id || result?.legacy?.id_str;
    console.log(`  → Posted ID: ${id}`);
    return { id };
  }

  // ─── LIKE ────────────────────────────────────────────────────────────────
  async likeTweet(tweetId) {
    const twidMatch = this.cookies.match(/twid=u%3D(\d+)/);
    const userId = twidMatch ? twidMatch[1] : null;
    if (!userId) throw new Error('twid cookie not found — cannot like');
    await this._gql('lI07N6Otwv1PhnEgXILM7A', 'FavoriteTweet', { tweet_id: tweetId, userId });
  }

  // ─── RETWEET ─────────────────────────────────────────────────────────────
  async retweet(tweetId) {
    const body = new URLSearchParams({ id: tweetId });
    const res = await fetch(`https://api.twitter.com/1.1/statuses/retweet/${tweetId}.json`, {
      method: 'POST',
      headers: this._headers({ 'content-type': 'application/x-www-form-urlencoded' }),
      body: body.toString(),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Retweet failed ${res.status}: ${t.substring(0, 200)}`);
    }
    return res.json();
  }

  // ─── FOLLOW ──────────────────────────────────────────────────────────────
  async followUser(username) {
    const body = new URLSearchParams({ screen_name: username.replace('@', '') });
    const res = await fetch('https://api.twitter.com/1.1/friendships/create.json', {
      method: 'POST',
      headers: this._headers({ 'content-type': 'application/x-www-form-urlencoded' }),
      body: body.toString(),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Follow failed ${res.status}: ${t.substring(0, 200)}`);
    }
  }

  // ─── PROFILE ─────────────────────────────────────────────────────────────
  async getProfile(username) {
    const data = await this._rest('users/show.json', {
      screen_name: username.replace('@', ''),
      include_entities: false,
    });
    return {
      id: data.id_str,
      name: data.name,
      username: data.screen_name,
      followersCount: data.followers_count || 0,
      biography: data.description || '',
    };
  }

  // ─── SEARCH ──────────────────────────────────────────────────────────────
  async *searchTweets(query, limit = 20) {
    const data = await this._rest('search/tweets.json', {
      q: query,
      result_type: 'recent',
      count: Math.min(limit, 100),
      tweet_mode: 'extended',
    });
    for (const tweet of data?.statuses || []) {
      yield {
        id: tweet.id_str,
        text: tweet.full_text || tweet.text || '',
        likeCount: tweet.favorite_count || 0,
        username: tweet.user?.screen_name,
        timeParsed: new Date(tweet.created_at),
      };
    }
  }

  // ─── USER TIMELINE ───────────────────────────────────────────────────────
  async *getTweets(username, limit = 10) {
    const tweets = await this._rest('statuses/user_timeline.json', {
      screen_name: username.replace('@', ''),
      count: Math.min(limit, 200),
      tweet_mode: 'extended',
      exclude_replies: false,
      include_rts: false,
    });
    for (const tweet of tweets || []) {
      yield {
        id: tweet.id_str,
        text: tweet.full_text || tweet.text || '',
        likeCount: tweet.favorite_count || 0,
        timeParsed: new Date(tweet.created_at),
      };
    }
  }

  // ─── MENTIONS ────────────────────────────────────────────────────────────
  async *getMentions(handle, limit = 30) {
    const clean = handle.replace('@', '');
    const data = await this._rest('search/tweets.json', {
      q: `@${clean} -from:${clean}`,
      result_type: 'recent',
      count: Math.min(limit, 100),
      tweet_mode: 'extended',
    });
    for (const tweet of data?.statuses || []) {
      const authorHandle = tweet.user?.screen_name || '';
      if (authorHandle.toLowerCase() === clean.toLowerCase()) continue;
      yield {
        id: tweet.id_str,
        text: tweet.full_text || tweet.text || '',
        username: authorHandle,
        likeCount: tweet.favorite_count || 0,
        timeParsed: new Date(tweet.created_at),
      };
    }
  }
}

module.exports = { XClient };
