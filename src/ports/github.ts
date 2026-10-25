export interface GitHubIssueEvent {
  installationId: number;
  repositoryId: number;
  repositoryFullName: string;
  issueId: number;
  issueNumber: number;
  senderId: number;
  senderLogin: string;
  title: string;
  body: string;
  action: 'opened' | 'edited';
  updatedAt: string;
}

export interface GitHubTrust {
  installationId: number;
  repositoryId: number;
  repositoryFullName: string;
  ownerId: string;
  projectId: string;
  authorizedSenderId: number;
}

export interface GitHubIssueSource {
  issue: GitHubIssueEvent;
  trust: GitHubTrust;
}
