export interface ReactionPlanAuthorizationRequest {
  localId: string;
  componentId: string;
  supervisorId: string;
  password: string;
  reason: string;
}

export interface ReactionPlanAuthorization {
  componentId: string;
  supervisorId: string;
  supervisorAuthorizationId: string;
  reason: string;
  approvedAt: Date;
}
