// Direct Twitter internal GraphQL client — no xactions dependency
// Uses the same endpoints the web client uses

const BEARER = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

const FEATURES = {
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
    // cookieString = "auth_token=XXX; ct0=YYY"
    this.cookies = cookieString;
    const ct0Match = cookieString.match(/ct0=([^;]+)/);
    this.ct0 = ct0Match ? ct0Match[1].trim() : null;
    if (!this.ct0) throw new Error('ct0 not found in cookie string');
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
      'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'referer': 'https://x.com/',
      'origin': 'https://x.com',
      ...extra,
    };
  }

  async _gql(queryId, opName, variables, method = 'POST') {
    const url = `https://x.com/i/api/graphql/${queryId}/${opName}`;
    if (method === 'GET') {
      const params = new URLSearchParams({
        variables: JSON.stringify(variables),
        features: JSON.stringify(FEATURES),
      });
      const res = await fetch(`${url}?${params}`, { headers: this._headers() });
      if (!res.ok) throw new Error(`${opName} failed: ${res.status} ${await res.text()}`);
      return res.json();
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: this._headers(),
      body: JSON.stringify({ variables, features: FEATURES, queryId }),
    });
    if (!res.ok) throw new Error(`${opName} failed: ${res.status} ${await res.text()}`);
    return res.json();
  }

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
    return { id: result?.rest_id || result?.legacy?.id_str || null };
  }

  async likeTweet(tweetId) {
    // Need user ID from twid cookie: u%3D<userId>
    const twidMatch = this.cookies.match(/twid=u%3D(\d+)/);
    const userId = twidMatch ? twidMatch[1] : null;
    if (!userId) throw new Error('twid cookie not found — cannot like');
    await this._gql('lI07N6Otwv1PhnEgXILM7A', 'FavoriteTweet', { tweet_id: tweetId, userId });
  }

  async followUser(username) {
    // First get user ID
    const profile = await this.getProfile(username);
    const userId = profile.id;
    if (!userId) throw new Error(`Cannot resolve ID for @${username}`);

    const body = new URLSearchParams({ user_id: userId });
    const res = await fetch('https://x.com/i/api/1.1/friendships/create.json', {
      method: 'POST',
      headers: this._headers({ 'content-type': 'application/x-www-form-urlencoded' }),
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`Follow failed: ${res.status}`);
  }

  async getProfile(username) {
    const clean = username.replace('@', '');
    const data = await this._gql('xc8f1g7BYqr6VTzTbvNLGg', 'UserByScreenName',
      { screen_name: clean, withSafetyModeUserFields: true }, 'GET'
    );
    const u = data?.data?.user?.result?.legacy;
    const id = data?.data?.user?.result?.rest_id;
    return {
      id,
      name: u?.name,
      username: u?.screen_name,
      followersCount: u?.followers_count || 0,
      biography: u?.description || '',
    };
  }

  async *searchTweets(query, limit = 20) {
    const variables = {
      rawQuery: query,
      count: Math.min(limit, 20),
      querySource: 'typed_query',
      product: 'Latest',
    };
    const data = await this._gql('gkjsKepM6gl_HmFWoWKfgg', 'SearchTimeline', variables, 'GET');
    const instructions = data?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions || [];
    for (const instr of instructions) {
      for (const entry of instr.entries || []) {
        const tweet = entry?.content?.itemContent?.tweet_results?.result?.legacy;
        const id = entry?.content?.itemContent?.tweet_results?.result?.rest_id;
        const username = entry?.content?.itemContent?.tweet_results?.result?.core?.user_results?.result?.legacy?.screen_name;
        if (tweet && id) {
          yield {
            id,
            text: tweet.full_text || tweet.text || '',
            likeCount: tweet.favorite_count || 0,
            username,
            timeParsed: tweet.created_at ? new Date(tweet.created_at) : new Date(),
          };
        }
      }
    }
  }

  async *getTweets(username, limit = 10) {
    const profile = await this.getProfile(username);
    if (!profile.id) return;
    const variables = {
      userId: profile.id,
      count: Math.min(limit, 20),
      includePromotedContent: false,
      withQuickPromoteEligibilityTweetFields: true,
      withVoice: true,
      withV2Timeline: true,
    };
    const data = await this._gql('E3opETHurmVJflFsUBVuUQ', 'UserTweets', variables, 'GET');
    const instructions = data?.data?.user?.result?.timeline_v2?.timeline?.instructions || [];
    for (const instr of instructions) {
      for (const entry of instr.entries || []) {
        const result = entry?.content?.itemContent?.tweet_results?.result;
        const tweet = result?.legacy;
        const id = result?.rest_id;
        if (tweet && id && !tweet.retweeted_status_id_str) {
          yield {
            id,
            text: tweet.full_text || tweet.text || '',
            likeCount: tweet.favorite_count || 0,
            timeParsed: tweet.created_at ? new Date(tweet.created_at) : new Date(),
          };
        }
      }
    }
  }

  // Get mentions — searches for tweets replying to/mentioning the handle
  async *getMentions(handle, limit = 30) {
    const clean = handle.replace('@', '');
    // Search for replies directed at this account in last 24h
    const query = `@${clean} -from:${clean}`;
    const variables = {
      rawQuery: query,
      count: Math.min(limit, 30),
      querySource: 'typed_query',
      product: 'Latest',
    };
    const data = await this._gql('gkjsKepM6gl_HmFWoWKfgg', 'SearchTimeline', variables, 'GET');
    const instructions = data?.data?.search_by_raw_query?.search_timeline?.timeline?.instructions || [];
    for (const instr of instructions) {
      for (const entry of instr.entries || []) {
        const result = entry?.content?.itemContent?.tweet_results?.result;
        const tweet = result?.legacy;
        const id = result?.rest_id;
        const authorHandle = result?.core?.user_results?.result?.legacy?.screen_name;
        if (tweet && id && authorHandle && authorHandle.toLowerCase() !== clean.toLowerCase()) {
          yield {
            id,
            text: tweet.full_text || tweet.text || '',
            username: authorHandle,
            likeCount: tweet.favorite_count || 0,
            replyCount: tweet.reply_count || 0,
            timeParsed: tweet.created_at ? new Date(tweet.created_at) : new Date(),
          };
        }
      }
    }
  }
}

module.exports = { XClient };
