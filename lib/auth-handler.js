const sessions = require('client-sessions')
const OAuth2 = require('client-oauth2')
const { atob, btoa } = require('Base64')
const { get } = require('axios')
const { parse } = require('qs')

const sessionName = 'sohoHouseSession'

module.exports = class AuthHandler {
  constructor ({ req, res, options }) {
    this.req = req
    this.res = res
    this.opts = options
  }

  get auth () {
    if (this.authClient) return this.authClient
    this.authClient = new OAuth2({
      authorizationUri: `${this.opts.oauthHost}/oauth/authorize`,
      accessTokenUri: `${this.opts.oauthHost}/oauth/token`,
      clientId: this.opts.oauthClientID,
      clientSecret: this.opts.oauthClientSecret,
      redirectUri: `http://${this.req.headers.host}/auth/callback`
    })
    return this.authClient
  }

  redirect (path) {
    this.res.writeHead(301, { location: path })
    this.res.end()
  }

  createSession () {
    return new Promise(resolve => sessions({
      cookieName: sessionName,
      secret: this.opts.secretKey,
      duration: 24 * 60 * 60 * 1000
    })(this.req, this.res, resolve))
  }

  async authenticateToken () {
    let redirectUrl
    try {
      const { state } = parse(this.req.url.split('?')[1])
      redirectUrl = JSON.parse(atob(state)).redirectUrl
    } catch (e) {
      redirectUrl = '/'
    }
    try {
      const token = await this.auth.code.getToken(this.req.url)
      const { accessToken, refreshToken, expires } = token
      const { data } = await get(`${this.opts.oauthHost}/api/v1/me`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      })
      const newUser = Object.assign({}, data, { token: accessToken })
      await this.saveUser(newUser, { refreshToken, expires })
      return this.redirect(redirectUrl)
    } catch (e) {
      console.error(e)
      return this.redirectToOAuth(redirectUrl)
    }
  }

  async saveUser (user, token) {
    if (!this.req[sessionName]) await this.createSession()
    this.req[sessionName].user = user
    this.req[sessionName].token = token
    this.req.user = user
  }

  async updateUser () {
    await this.createSession()
    let { user, token } = this.req[sessionName]

    if (!user) return false
    try {
      const newToken = await this.auth.createToken(user.token, token.refreshToken, 'bearer')
      newToken.expiresIn(new Date(token.expires))

      if (newToken.expired()) {
        const { accessToken, refreshToken } = await newToken.refresh()
        user.token = accessToken
        token.refreshToken = refreshToken
      }
    } catch (e) {
      user = token = {}
    }

    return this.saveUser(user, token)
  }

  async redirectToOAuth (redirect) {
    const redirectUrl = redirect || this.req.url
    const state = JSON.stringify({ redirectUrl })
    const url = this.auth.code.getUri({
      state: btoa(state)
    })
    return this.redirect(url)
  }
}