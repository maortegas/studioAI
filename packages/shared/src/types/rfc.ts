export type RFCStatus = 'draft' | 'review' | 'approved' | 'implemented';
export type ArchitectureType = 'monorepo' | 'polyrepo' | 'microservices' | 'monolithic' | 'serverless';
export type ContractType = 'openapi' | 'swagger' | 'graphql' | 'grpc';
export type SchemaType = 'sql' | 'nosql' | 'graph' | 'document';

export interface RFCDocument {
  id: string;
  project_id: string;
  title: string;
  content: string; // Markdown
  architecture_type?: ArchitectureType;
  status: RFCStatus;
  created_at: Date;
  updated_at: Date;
}

export interface APIContract {
  id: string;
  rfc_id: string;
  contract_type: ContractType;
  contract_content: Record<string, any>; // OpenAPI/Swagger JSON or GraphQL schema
  file_path?: string;
  version?: string;
  created_at: Date;
  updated_at: Date;
}

export interface DatabaseSchema {
  id: string;
  rfc_id: string;
  schema_type: SchemaType;
  schema_content: string; // SQL DDL or NoSQL schema
  migrations_path?: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateRFCRequest {
  project_id: string;
  title: string;
  content: string;
  architecture_type?: ArchitectureType;
}

export interface UpdateRFCRequest {
  title?: string;
  content?: string;
  architecture_type?: ArchitectureType;
  status?: RFCStatus;
}

export interface GenerateRFCRequest {
  project_id: string;
  prd_id: string;
  story_ids?: string[]; // Optional: specific stories to include
  options?: {
    include_diagrams?: boolean;
    include_api_contracts?: boolean;
    include_database_schema?: boolean;
    architecture_type?: ArchitectureType;
  };
}
