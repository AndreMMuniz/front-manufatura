export interface ReactionPlanAuthorizationRequest {
  componentId: string;
  supervisorId: string;
  password: string;
  reason: string;
}

export interface ReactionPlanAuthorization {
  componentId: string;
  supervisorId: string;
  reason: string;
  approvedAt: Date;
}
