import type { TunnelStatus } from './runtime';

export interface TunnelState {
	status: TunnelStatus;
	url: string | null;
	error: string | null;
}
