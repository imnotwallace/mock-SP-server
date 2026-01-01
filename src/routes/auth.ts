import { Router, Request, Response } from 'express';
import { registerOAuthToken } from '../middleware/auth.js';

/**
 * Generate a random OAuth token
 */
function generateToken(): string {
  const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const length = 64;
  let token = '';
  for (let i = 0; i < length; i++) {
    token += characters.charAt(Math.floor(Math.random() * characters.length));
  }
  return token;
}

/**
 * OAuth token response format
 */
interface TokenResponse {
  token_type: string;
  expires_in: number;
  access_token: string;
}

/**
 * Create OAuth authentication router
 */
export function createAuthRouter(): Router {
  const router = Router();

  /**
   * POST /oauth/token
   * Mock OAuth token endpoint
   */
  router.post('/token', (req: Request, res: Response) => {
    // Generate and register a new token
    const token = generateToken();
    registerOAuthToken(token);

    // Return OAuth response
    const response: TokenResponse = {
      token_type: 'Bearer',
      expires_in: 3600, // 1 hour
      access_token: token
    };

    res.json(response);
  });

  /**
   * GET /oauth/authorize
   * Mock OAuth authorization endpoint
   */
  router.get('/authorize', (req: Request, res: Response) => {
    // Mock authorization response
    res.json({
      status: 'ok',
      message: 'Mock OAuth authorization endpoint',
      client_id: req.query.client_id || null,
      response_type: req.query.response_type || null,
      redirect_uri: req.query.redirect_uri || null
    });
  });

  return router;
}
