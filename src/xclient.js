// Direct Twitter client — GraphQL for writes + reads
// v1.1 REST is dead for external accounts — using GraphQL throughout

const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// GraphQL query IDs (verified working 2025-06)
const QID = {
  CreateTweet:         'a1p9RWpkYKBjWv_I3WzS-A',
  FavoriteTweet:       'lI07N6Otwv1PhnEgXILM7A',
  UserByScreenName:    'qW5u-DAuXpMEG0zA1F7UGQ',
  UserTweets:          'V7H0Ap3_Hh2FyS75OCDO3Q',
  TweetResultByRestId: 'VwKLqiECkBaVo6HsfISIGg',
};

const GQL_TWEET_FEATURES = {
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

const GQL_USER_FEATURES = {
  hidden_profile_subscriptions_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  verified_phone_label_enabled: false,
  subscriptions_verification_info_is_identity_verified_enabled: true,
  subscriptions_verification_info_verified_since_enabled: true,
  highlights_tweets_tab_ui_enabled: true,
  responsive_web_twitter_article_notes_tab_enabled: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
};

class XClient {
  constructor(cookieString) {
    if (!cookieString) throw new Error('XACTIONS_SESSION_COOKIE is not set');
    this.cookies = cookieString;
    const ct0Match = cookieString.match(/ct0=([^;]+)/);
    this.ct0 = ct0Match ? ct0Match[1].trim() : null;
    if (!this.ct0) throw new Error('ct0 not found in cookie string');
    // userId cache: username → numeric id string
    this._userIdCache = {};
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

  // GraphQL POST (writes)
  async _gql(queryId, opName, variables) {
    const url = `https://x.com/i/api/graphql/${queryId}/${opName}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ variables, features: GQL_TWEET_FEATURES, queryId }),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${opName} HTTP ${res.status}: ${text.substring(0, 300)}`);
    const data = JSON.parse(text);
    if (data?.errors?.length) throw new Error(`${opName} error: ${data.errors[0]?.message}`);
    return data;
  }

  // GraphQL GET (reads)
  async _gqlGet(queryId, opName, variables, features = GQL_USER_FEATURES) {
    const url = `https://x.com/i/api/graphql/${queryId}/${opName}` +
      `?variables=${encodeURIComponent(JSON.stringify(variables))}` +
      `&features=${encodeURIComponent(JSON.stringify(features))}`;
    const res = await fetch(url, { headers: this._headers() });
    const text = await res.text();
    if (!text || !text.trim()) return null;
    if (!res.ok) {
      try {
        const d = JSON.parse(text);
        if (d?.message === 'Query not found') throw new Error(`QueryId stale: ${queryId}`);
      } catch (e) { if (e.message.includes('QueryId')) throw e; }
      throw new Error(`${opName} HTTP ${res.status}: ${text.substring(0, 300)}`);
    }
    return JSON.parse(text);
  }

  // v1.1 REST — only used where it still works (mentions, statuses/show)
  async _rest(path, params = {}) {
    const url = new URL(`https://api.twitter.com/1.1/${path}`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
    const res = await fetch(url.toString(), { headers: this._headers() });
    const text = await res.text();
    if (!text || !text.trim()) return null;
    if (!res.ok) {
      if (res.status === 404) {
        try { const d = JSON.parse(text); if (d?.errors?.[0]?.code === 34) return null; } catch {}
      }
      throw new Error(`REST ${path} HTTP ${res.status}: ${text.substring(0, 300)}`);
    }
    return JSON.parse(text);
  }

  // ─── USER ID LOOKUP ──────────────────────────────────────────────────────
  async _getUserId(username) {
    const clean = username.replace('@', '').toLowerCase();
    if (this._userIdCache[clean]) return this._userIdCache[clean];
    const data = await this._gqlGet(QID.UserByScreenName, 'UserByScreenName',
      { screen_name: clean, withSafetyModeUserFields: true });
    const userId = data?.data?.user?.result?.rest_id;
    if (!userId) throw new Error(`Could not resolve userId for @${clean}`);
    this._userIdCache[clean] = userId;
    return userId;
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
    if (options.quoteTweetId) {
      variables.attachment_url = `https://x.com/i/status/${options.quoteTweetId}`;
    }
    const data = await this._gql(QID.CreateTweet, 'CreateTweet', variables);
    const result = data?.data?.create_tweet?.tweet_results?.result;
    if (!result) throw new Error(`Tweet not posted — response: ${JSON.stringify(data).substring(0, 200)}`);
    const id = result?.rest_id || result?.legacy?.id_str;
    console.log(`  → Posted ID: ${id}`);
    return { id };
  }

  // ─── LIKE ────────────────────────────────────────────────────────────────
  async likeTweet(tweetId) {
    // Try twid cookie first, fall back to GraphQL profile lookup
    let userId = null;
    const twidMatch = this.cookies.match(/twid=u%3D(\d+)/);
    if (twidMatch) {
      userId = twidMatch[1];
    } else if (this._ownUserId) {
      userId = this._ownUserId;
    } else {
      try {
        const data = await this._gqlGet(QID.UserByScreenName, 'UserByScreenName',
          { screen_name: 'kerimaydemirco', withSafetyModeUserFields: true });
        userId = data?.data?.user?.result?.rest_id || null;
        if (userId) this._ownUserId = userId;
      } catch {}
    }
    await this._gql(QID.FavoriteTweet, 'FavoriteTweet',
      userId ? { tweet_id: tweetId, userId } : { tweet_id: tweetId });
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

  // ─── PROFILE — GraphQL UserByScreenName ──────────────────────────────────
  async getProfile(username) {
    const clean = username.replace('@', '');
    const data = await this._gqlGet(QID.UserByScreenName, 'UserByScreenName',
      { screen_name: clean, withSafetyModeUserFields: true });
    const result = data?.data?.user?.result;
    if (!result) throw new Error(`Profile not found: @${clean}`);
    const legacy = result.legacy || {};
    this._userIdCache[clean.toLowerCase()] = result.rest_id;
    return {
      id: result.rest_id,
      name: legacy.name || clean,
      username: legacy.screen_name || clean,
      followersCount: legacy.followers_count || 0,
      biography: legacy.description || '',
    };
  }

  // ─── USER TIMELINE — GraphQL UserTweets ──────────────────────────────────
  async *getTweets(username, limit = 10) {
    const userId = await this._getUserId(username);
    const data = await this._gqlGet(QID.UserTweets, 'UserTweets', {
      userId,
      count: Math.min(limit, 20),
      includePromotedContent: false,
      withQuickPromoteEligibilityTweetFields: true,
      withVoice: true,
      withV2Timeline: true,
    }, GQL_TWEET_FEATURES);

    if (!data) return;
    const instructions = data?.data?.user?.result?.timeline_v2?.timeline?.instructions || [];
    for (const inst of instructions) {
      for (const entry of (inst.entries || [])) {
        const tweetResult = entry?.content?.itemContent?.tweet_results?.result;
        const legacy = tweetResult?.legacy || tweetResult?.tweet?.legacy;
        if (!legacy?.full_text) continue;
        if (legacy.retweeted_status_id_str) continue; // skip retweets
        yield {
          id: legacy.id_str || tweetResult?.rest_id,
          text: legacy.full_text || '',
          likeCount: legacy.favorite_count || 0,
          retweetCount: legacy.retweet_count || 0,
          replyCount: legacy.reply_count || 0,
          timeParsed: new Date(legacy.created_at),
        };
      }
    }
  }

  // ─── SINGLE TWEET LOOKUP — GraphQL first, v1.1 fallback ─────────────────
  async getTweetById(tweetId) {
    try {
      const data = await this._gqlGet(QID.TweetResultByRestId, 'TweetResultByRestId', {
        tweetId,
        withCommunity: false,
        includePromotedContent: false,
        withVoice: false,
      });
      const result = data?.data?.tweetResult?.result;
      const legacy = result?.legacy || result?.tweet?.legacy;
      if (legacy) {
        return {
          id: tweetId,
          text: legacy.full_text || '',
          likes: legacy.favorite_count || 0,
          retweets: legacy.retweet_count || 0,
          replies: legacy.reply_count || 0,
        };
      }
    } catch {}

    // Fallback: v1.1 REST (may still work for own tweets)
    const data = await this._rest('statuses/show.json', {
      id: tweetId,
      tweet_mode: 'extended',
    });
    if (!data) return null;
    return {
      id: data.id_str,
      text: data.full_text || data.text || '',
      likes: data.favorite_count || 0,
      retweets: data.retweet_count || 0,
      replies: data.reply_count || 0,
    };
  }

  // ─── SEARCH — v1.1 (returns empty if restricted) ─────────────────────────
  async *searchTweets(query, limit = 20) {
    const data = await this._rest('search/tweets.json', {
      q: query,
      result_type: 'recent',
      count: Math.min(limit, 100),
      tweet_mode: 'extended',
    });
    for (const tweet of (data?.statuses || [])) {
      yield {
        id: tweet.id_str,
        text: tweet.full_text || tweet.text || '',
        likeCount: tweet.favorite_count || 0,
        username: tweet.user?.screen_name,
        timeParsed: new Date(tweet.created_at),
      };
    }
  }

  // ─── MENTIONS — v1.1 mentions_timeline ───────────────────────────────────
  async *getMentions(handle, limit = 30) {
    const data = await this._rest('statuses/mentions_timeline.json', {
      count: Math.min(limit, 200),
      tweet_mode: 'extended',
    });
    const clean = handle.replace('@', '').toLowerCase();
    for (const tweet of (data || [])) {
      const authorHandle = tweet.user?.screen_name || '';
      if (authorHandle.toLowerCase() === clean) continue;
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
