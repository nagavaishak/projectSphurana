import { fetchWithTimeout } from '@borradh-workspace/http';
import type {
  PhorestBooking,
  PhorestClient,
  PhorestService,
  PhorestStaff,
} from './booking.types.js';

/**
 * Phorest API regions
 */
type PhorestRegion = 'eu' | 'us';

const PHOREST_API_BASE: Record<PhorestRegion, string> = {
  eu: 'https://platform.phorest.com/third-party-api-server/api/business',
  us: 'https://platform-us.phorest.com/third-party-api-server/api/business',
};

/**
 * Service for interacting with Phorest API
 *
 * Phorest uses Basic Authentication (username/password), not OAuth.
 * Credentials are provided by Phorest support when you request API access.
 *
 * Important notes:
 * - Username format: global/[email]
 * - All booking times are in UTC
 * - API does not support webhooks (polling required)
 * - Payments cannot be processed via API
 *
 * @see https://developer.phorest.com/docs/getting-started
 */
export class PhorestApiService {
  private username: string;
  private password: string;
  private businessId: string;
  private region: PhorestRegion;
  private baseUrl: string;

  constructor(config: {
    username: string;
    password: string;
    businessId: string;
    region?: PhorestRegion;
  }) {
    this.username = config.username;
    this.password = config.password;
    this.businessId = config.businessId;
    this.region = config.region || 'eu';
    this.baseUrl = PHOREST_API_BASE[this.region];
  }

  /**
   * Get the Authorization header for API requests
   */
  private getAuthHeader(): string {
    const credentials = Buffer.from(
      `${this.username}:${this.password}`
    ).toString('base64');
    return `Basic ${credentials}`;
  }

  /**
   * Make an authenticated API request
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}/${this.businessId}${endpoint}`;
    const options: RequestInit = {
      method,
      headers: {
        Authorization: this.getAuthHeader(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    };
    if (body) {
      options.body = JSON.stringify(body);
    }
    const response = await fetchWithTimeout(url, {
      ...options,
      timeoutMs: 15000,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Phorest API error (${response.status}): ${error}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Test the connection with provided credentials
   */
  async testConnection(): Promise<boolean> {
    try {
      await this.request<unknown>('GET', '/branches');
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get branches for the business
   */
  async getBranches(): Promise<
    Array<{ branchId: string; name: string; address?: string }>
  > {
    const data = await this.request<{
      _embedded: {
        branches: Array<{
          branchId: string;
          name: string;
          address?: { street?: string; city?: string };
        }>;
      };
    }>('GET', '/branches');

    return data._embedded.branches.map((branch) => ({
      branchId: branch.branchId,
      name: branch.name,
      address: branch.address
        ? `${branch.address.street || ''} ${branch.address.city || ''}`.trim()
        : undefined,
    }));
  }

  /**
   * Get clients for a branch
   */
  async getClients(
    branchId: string,
    page = 0,
    size = 50
  ): Promise<PhorestClient[]> {
    const data = await this.request<{
      _embedded: {
        clients: Array<{
          clientId: string;
          firstName: string;
          lastName: string;
          email?: string;
          mobile?: string;
          createdAt: string;
        }>;
      };
    }>('GET', `/branch/${branchId}/client?page=${page}&size=${size}`);

    return data._embedded.clients.map((client) => ({
      clientId: client.clientId,
      firstName: client.firstName,
      lastName: client.lastName,
      email: client.email,
      mobile: client.mobile,
      createdAt: client.createdAt,
    }));
  }

  /**
   * Create a client
   */
  async createClient(
    branchId: string,
    client: {
      firstName: string;
      lastName: string;
      email?: string;
      mobile?: string;
    }
  ): Promise<PhorestClient> {
    const data = await this.request<{
      clientId: string;
      firstName: string;
      lastName: string;
      email?: string;
      mobile?: string;
      createdAt: string;
    }>('POST', `/branch/${branchId}/client`, client);

    return {
      clientId: data.clientId,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email,
      mobile: data.mobile,
      createdAt: data.createdAt,
    };
  }

  /**
   * Get services for a branch
   */
  async getServices(branchId: string): Promise<PhorestService[]> {
    const data = await this.request<{
      _embedded: {
        services: Array<{
          serviceId: string;
          name: string;
          durationMins: number;
          price: number;
          serviceGroupName?: string;
        }>;
      };
    }>('GET', `/branch/${branchId}/service`);

    return data._embedded.services.map((service) => ({
      id: service.serviceId,
      name: service.name,
      duration: service.durationMins,
      price: service.price,
      category: service.serviceGroupName,
    }));
  }

  /**
   * Get staff for a branch
   */
  async getStaff(branchId: string): Promise<PhorestStaff[]> {
    const data = await this.request<{
      _embedded: {
        staff: Array<{
          staffId: string;
          firstName: string;
          lastName: string;
          email?: string;
        }>;
      };
    }>('GET', `/branch/${branchId}/staff`);

    return data._embedded.staff.map((staff) => ({
      id: staff.staffId,
      firstName: staff.firstName,
      lastName: staff.lastName,
      email: staff.email,
    }));
  }

  /**
   * Get available appointment slots
   */
  async getAvailableSlots(
    branchId: string,
    params: {
      serviceId: string;
      staffId?: string;
      startDate: string;
      endDate: string;
    }
  ): Promise<
    Array<{
      startTime: string;
      endTime: string;
      staffId: string;
    }>
  > {
    const queryParams = new URLSearchParams({
      serviceId: params.serviceId,
      startDate: params.startDate,
      endDate: params.endDate,
    });
    if (params.staffId) {
      queryParams.set('staffId', params.staffId);
    }

    const data = await this.request<{
      _embedded: {
        availabilities: Array<{
          startTime: string;
          endTime: string;
          staffId: string;
        }>;
      };
    }>(
      'GET',
      `/branch/${branchId}/booking/availability?${queryParams.toString()}`
    );

    return data._embedded.availabilities;
  }

  /**
   * Create a booking/appointment
   */
  async createBooking(
    branchId: string,
    booking: {
      clientId: string;
      staffId: string;
      startTime: string; // ISO 8601 UTC
      services: Array<{ serviceId: string }>;
      notes?: string;
    }
  ): Promise<PhorestBooking> {
    const data = await this.request<{
      appointmentId: string;
      startTime: string;
      endTime: string;
      status: string;
      clientId: string;
      staffId: string;
      notes?: string;
      services: Array<{
        serviceId: string;
        name: string;
        durationMins: number;
        price?: number;
      }>;
    }>('POST', `/branch/${branchId}/booking`, {
      clientId: booking.clientId,
      staffId: booking.staffId,
      startTime: booking.startTime,
      services: booking.services,
      notes: booking.notes,
    });

    return {
      id: data.appointmentId,
      startDateTime: data.startTime,
      endDateTime: data.endTime,
      status: data.status,
      clientId: data.clientId,
      staffId: data.staffId,
      services: data.services.map((s) => ({
        serviceId: s.serviceId,
        name: s.name,
        duration: s.durationMins,
        price: s.price,
      })),
      notes: data.notes,
    };
  }

  /**
   * Get bookings for a branch
   */
  async getBookings(
    branchId: string,
    params: {
      startDate: string;
      endDate: string;
      staffId?: string;
      clientId?: string;
    }
  ): Promise<PhorestBooking[]> {
    const queryParams = new URLSearchParams({
      startDate: params.startDate,
      endDate: params.endDate,
    });
    if (params.staffId) queryParams.set('staffId', params.staffId);
    if (params.clientId) queryParams.set('clientId', params.clientId);

    const data = await this.request<{
      _embedded: {
        appointments: Array<{
          appointmentId: string;
          startTime: string;
          endTime: string;
          status: string;
          clientId?: string;
          staffId?: string;
          notes?: string;
          services: Array<{
            serviceId: string;
            name: string;
            durationMins: number;
            price?: number;
          }>;
        }>;
      };
    }>('GET', `/branch/${branchId}/appointment?${queryParams.toString()}`);

    return data._embedded.appointments.map((apt) => ({
      id: apt.appointmentId,
      startDateTime: apt.startTime,
      endDateTime: apt.endTime,
      status: apt.status,
      clientId: apt.clientId,
      staffId: apt.staffId,
      services: apt.services.map((s) => ({
        serviceId: s.serviceId,
        name: s.name,
        duration: s.durationMins,
        price: s.price,
      })),
      notes: apt.notes,
    }));
  }

  /**
   * Cancel a booking
   */
  async cancelBooking(branchId: string, appointmentId: string): Promise<void> {
    await this.request<void>(
      'PUT',
      `/branch/${branchId}/appointment/${appointmentId}/cancel`
    );
  }
}
