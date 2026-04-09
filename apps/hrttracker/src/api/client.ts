import type {
  ApiResponse,
  AuthTokens,
  LoginRequest,
  RegisterRequest,
  RefreshTokenRequest,
  LogoutResponse,
  SessionsResponse,
  RevokeSessionRequest,
  SetSecurityPasswordRequest,
  UpdateSecurityPasswordRequest,
  SecurityPasswordStatusResponse,
  GetUserDataRequest,
  UserDataResponse,
  UpdateUserDataRequest,
  CreateShareRequest,
  CreateShareResponse,
  Share,
  UpdateSharePasswordRequest,
  UpdateShareLockRequest,
  ViewShareRequest,
  ViewShareResponse,
  UploadAvatarResponse,
  ChangePasswordRequest,
  ChangePasswordResponse,
  StatisticsResponse,
  OIDCConfig,
  OIDCAuthorizeResponse,
  OIDCCallbackRequest,
  OIDCCallbackResponse,
  OIDCBindStatusResponse,
  SetLoginPasswordRequest,
  RemoveLoginPasswordRequest,
  UserMeResponse,
} from './types';

import { API_BASE_URL } from './config';

class ApiClient {
  private baseUrl: string;
  private accessToken: string | null = null;
  private refreshTokenCallback: (() => Promise<boolean>) | null = null;
  private isRefreshing: boolean = false;
  private refreshTimeoutMs: number = 10000; // 10 second timeout for token refresh
  private requestQueue: Array<{
    execute: () => Promise<any>;
    resolve: (value: any) => void;
    reject: (error: any) => void;
  }> = [];

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  setAccessToken(token: string | null) {
    this.accessToken = token;
  }

  setRefreshTokenCallback(callback: () => Promise<boolean>) {
    this.refreshTokenCallback = callback;
  }

  /**
   * Execute token refresh with timeout protection
   * Prevents refresh from hanging indefinitely
   */
  private async executeRefreshWithTimeout(): Promise<boolean> {
    if (!this.refreshTokenCallback) {
      throw new Error('Refresh token callback not set');
    }

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutPromise = new Promise<boolean>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error('Token refresh timed out'));
      }, this.refreshTimeoutMs);
    });

    try {
      // Race between refresh and timeout
      const result = await Promise.race([
        this.refreshTokenCallback(),
        timeoutPromise,
      ]);

      // Clear timeout on success
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      return result;
    } catch (error) {
      // Clear timeout on error
      if (timeoutId) {
        clearTimeout(timeoutId);
      }

      if (error instanceof Error && error.message === 'Token refresh timed out') {
        console.error('Token refresh exceeded timeout of', this.refreshTimeoutMs, 'ms');
      }
      throw error;
    }
  }

  /**
   * Unified token refresh and queue processing handler
   * Handles refresh logic and queued requests in a consistent way
   * Used by both request() and uploadAvatar()
   */
  private async handleTokenRefreshAndQueue(): Promise<boolean> {
    try {
      const refreshed = await this.executeRefreshWithTimeout();

      if (refreshed) {
        // Process queued requests
        const queue = [...this.requestQueue];
        this.requestQueue = [];

        // Process all queued requests asynchronously
        // Note: Always resolve (never reject) to maintain consistency with direct API calls
        queue.forEach((queuedRequest) => {
          queuedRequest.execute()
            .then(queuedRequest.resolve)
            .catch((error) => {
              // Convert exception to ApiResponse format for consistency
              queuedRequest.resolve({
                success: false,
                error: error instanceof Error ? error.message : 'Request failed',
              });
            });
        });

        return true;
      } else {
        // Refresh failed, resolve all queued requests with error
        const queue = [...this.requestQueue];
        this.requestQueue = [];

        const authError: ApiResponse<any> = {
          success: false,
          error: 'Authentication failed',
          status: 401,
        };

        queue.forEach((queuedRequest) => {
          queuedRequest.resolve(authError);
        });

        return false;
      }
    } catch (error) {
      // Handle refresh callback exception
      const queue = [...this.requestQueue];
      this.requestQueue = [];

      const refreshError: ApiResponse<any> = {
        success: false,
        error: error instanceof Error ? error.message : 'Token refresh failed',
        status: 500,
      };

      queue.forEach((queuedRequest) => {
        queuedRequest.resolve(refreshError);
      });

      throw error;
    }
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {},
    timeout: number = 30000,
    hasRetried: boolean = false
  ): Promise<ApiResponse<T>> {
    const url = `${this.baseUrl}${endpoint}`;
    // Only set Content-Type for requests with a body to avoid unnecessary CORS preflights on GETs
    const hasBody = options.body !== undefined;
    const headers: HeadersInit = {
      ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    };

    // Public endpoints that don't need Authorization (exact match)
    const publicEndpoints = [
      '/auth/login',
      '/auth/register',
      '/auth/refresh',
      '/health',
      '/statistics',
      '/auth/oidc/config',
      '/auth/oidc/authorize',
      '/auth/oidc/callback',
    ];
    const isShareView = !!endpoint.match(/^\/shares\/[^/]+\/view$/);
    const needsAuth = !publicEndpoints.includes(endpoint) && !isShareView;

    if (this.accessToken && needsAuth) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      // Handle empty responses (like 204 No Content)
      let data: any;
      const text = await response.text();
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }

      if (!response.ok) {
        // Handle 401 Unauthorized - try to refresh token once
        if (response.status === 401 &&
            this.refreshTokenCallback &&
            needsAuth &&
            !hasRetried) {

          // If already refreshing, queue this request
          if (this.isRefreshing) {
            return new Promise((resolve, reject) => {
              this.requestQueue.push({
                execute: () => this.request<T>(endpoint, options, timeout, true),
                resolve,
                reject,
              });
            });
          }

          // Start refresh process
          this.isRefreshing = true;

          try {
            const refreshed = await this.handleTokenRefreshAndQueue();

            if (refreshed) {
              // Retry the original request with new token
              return await this.request<T>(endpoint, options, timeout, true);
            } else {
              // Refresh failed
              return {
                success: false,
                error: 'Authentication failed',
                status: 401,
              } as ApiResponse<T>;
            }
          } catch (error) {
            // Handle refresh exception
            return {
              success: false,
              error: error instanceof Error ? error.message : 'Token refresh failed',
              status: 500,
            } as ApiResponse<T>;
          } finally {
            this.isRefreshing = false;
          }
        }

        return {
          success: false,
          error: data.error || `HTTP ${response.status}`,
          status: response.status,
        };
      }

      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return {
            success: false,
            error: 'Request timeout',
          };
        }
        return {
          success: false,
          error: error.message,
        };
      }
      return {
        success: false,
        error: 'Network error',
      };
    }
  }

  // Auth APIs
  async register(data: RegisterRequest): Promise<ApiResponse<AuthTokens>> {
    return this.request<AuthTokens>('/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async login(data: LoginRequest): Promise<ApiResponse<AuthTokens>> {
    return this.request<AuthTokens>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async refreshToken(data: RefreshTokenRequest): Promise<ApiResponse<AuthTokens>> {
    return this.request<AuthTokens>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async logout(tokenOverride?: string): Promise<ApiResponse<LogoutResponse>> {
    return this.request<LogoutResponse>('/auth/logout', {
      method: 'POST',
      headers: tokenOverride ? { Authorization: `Bearer ${tokenOverride}` } : undefined,
    });
  }

  async getSessions(): Promise<ApiResponse<SessionsResponse>> {
    return this.request<SessionsResponse>('/auth/sessions');
  }

  async revokeSession(sessionId: string, data: RevokeSessionRequest): Promise<ApiResponse<void>> {
    return this.request<void>(`/auth/sessions/${sessionId}`, {
      method: 'DELETE',
      body: JSON.stringify(data),
    });
  }

  async revokeAllOtherSessions(data: RevokeSessionRequest): Promise<ApiResponse<{ revoked_count: number }>> {
    return this.request<{ revoked_count: number }>('/auth/sessions', {
      method: 'DELETE',
      body: JSON.stringify(data),
    });
  }

  // User Data APIs
  async setSecurityPassword(data: SetSecurityPasswordRequest): Promise<ApiResponse<void>> {
    return this.request<void>('/user/security-password', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateSecurityPassword(data: UpdateSecurityPasswordRequest): Promise<ApiResponse<void>> {
    return this.request<void>('/user/security-password', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async getSecurityPasswordStatus(): Promise<ApiResponse<SecurityPasswordStatusResponse>> {
    return this.request<SecurityPasswordStatusResponse>('/user/security-password/status');
  }

  async getUserData(data?: GetUserDataRequest): Promise<ApiResponse<UserDataResponse>> {
    return this.request<UserDataResponse>('/user/data', {
      method: 'POST',
      body: data ? JSON.stringify(data) : JSON.stringify({}),
    });
  }

  async updateUserData(data: UpdateUserDataRequest): Promise<ApiResponse<void>> {
    return this.request<void>('/user/data', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Share APIs
  async createShare(data: CreateShareRequest): Promise<ApiResponse<CreateShareResponse>> {
    return this.request<CreateShareResponse>('/shares', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getShares(): Promise<ApiResponse<Share[]>> {
    return this.request<Share[]>('/shares');
  }

  async deleteShare(shareId: string): Promise<ApiResponse<void>> {
    return this.request<void>(`/shares/${shareId}`, {
      method: 'DELETE',
    });
  }

  async updateSharePassword(shareId: string, data: UpdateSharePasswordRequest): Promise<ApiResponse<void>> {
    return this.request<void>(`/shares/${shareId}/password`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async updateShareLock(shareId: string, data: UpdateShareLockRequest): Promise<ApiResponse<void>> {
    return this.request<void>(`/shares/${shareId}/lock`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async viewShare(shareId: string, data?: ViewShareRequest): Promise<ApiResponse<ViewShareResponse>> {
    return this.request<ViewShareResponse>(`/shares/${shareId}/view`, {
      method: 'POST',
      body: data ? JSON.stringify(data) : JSON.stringify({}),
    });
  }

  // Avatar APIs
  async uploadAvatar(file: File, timeout: number = 30000, hasRetried: boolean = false): Promise<ApiResponse<UploadAvatarResponse>> {
    const formData = new FormData();
    formData.append('avatar', file);

    const url = `${this.baseUrl}/user/avatar`;
    const headers: HeadersInit = {};

    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: formData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      let data: any;
      const text = await response.text();
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        data = {};
      }

      if (!response.ok) {
        // Handle 401 Unauthorized - try to refresh token once
        if (response.status === 401 && this.refreshTokenCallback && !hasRetried) {
          // If already refreshing, queue this request
          if (this.isRefreshing) {
            return new Promise((resolve, reject) => {
              this.requestQueue.push({
                execute: () => this.uploadAvatar(file, timeout, true),
                resolve,
                reject,
              });
            });
          }

          // Start refresh process
          this.isRefreshing = true;

          try {
            const refreshed = await this.handleTokenRefreshAndQueue();

            if (refreshed) {
              // Retry the upload with new token
              return await this.uploadAvatar(file, timeout, true);
            } else {
              // Refresh failed
              return {
                success: false,
                error: 'Authentication failed',
                status: 401,
              };
            }
          } catch (error) {
            // Handle refresh exception
            return {
              success: false,
              error: error instanceof Error ? error.message : 'Token refresh failed',
              status: 500,
            };
          } finally {
            this.isRefreshing = false;
          }
        }

        return {
          success: false,
          error: data.error || `HTTP ${response.status}`,
          status: response.status,
        };
      }

      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          return {
            success: false,
            error: 'Upload timeout',
          };
        }
        return {
          success: false,
          error: error.message,
        };
      }
      return {
        success: false,
        error: 'Network error',
      };
    }
  }

  async deleteAvatar(): Promise<ApiResponse<{ message: string }>> {
    return this.request<{ message: string }>('/user/avatar', {
      method: 'DELETE',
    });
  }

  getAvatarUrl(username: string): string {
    // Encode username to prevent URL injection
    const encodedUsername = encodeURIComponent(username);
    return `${this.baseUrl}/avatars/${encodedUsername}`;
  }

  // Password Management APIs
  async changePassword(data: ChangePasswordRequest): Promise<ApiResponse<ChangePasswordResponse>> {
    return this.request<ChangePasswordResponse>('/user/password', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  // Health Check
  async healthCheck(): Promise<ApiResponse<{ status: string }>> {
    return this.request<{ status: string }>('/health');
  }

  // Statistics API
  async getStatistics(): Promise<ApiResponse<StatisticsResponse>> {
    return this.request<StatisticsResponse>('/statistics');
  }

  // OIDC APIs
  async getOIDCConfig(): Promise<ApiResponse<OIDCConfig>> {
    return this.request<OIDCConfig>('/auth/oidc/config');
  }

  async getOIDCAuthorizeUrl(): Promise<ApiResponse<OIDCAuthorizeResponse>> {
    return this.request<OIDCAuthorizeResponse>('/auth/oidc/authorize');
  }

  async oidcCallback(data: OIDCCallbackRequest): Promise<ApiResponse<OIDCCallbackResponse>> {
    return this.request<OIDCCallbackResponse>('/auth/oidc/callback', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getOIDCBindAuthorizeUrl(): Promise<ApiResponse<OIDCAuthorizeResponse>> {
    return this.request<OIDCAuthorizeResponse>('/auth/oidc/bind/authorize');
  }

  async oidcBindCallback(data: OIDCCallbackRequest): Promise<ApiResponse<{ message: string }>> {
    return this.request<{ message: string }>('/auth/oidc/bind/callback', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async getOIDCBindStatus(): Promise<ApiResponse<OIDCBindStatusResponse>> {
    return this.request<OIDCBindStatusResponse>('/auth/oidc/bind/status');
  }

  async setLoginPassword(data: SetLoginPasswordRequest): Promise<ApiResponse<{ message: string }>> {
    return this.request<{ message: string }>('/user/password', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async removeLoginPassword(data: RemoveLoginPasswordRequest): Promise<ApiResponse<{ message: string }>> {
    return this.request<{ message: string }>('/user/password', {
      method: 'DELETE',
      body: JSON.stringify(data),
    });
  }

  async getMe(): Promise<ApiResponse<UserMeResponse>> {
    return this.request<UserMeResponse>('/user/me');
  }
}

export const apiClient = new ApiClient();
export default apiClient;
