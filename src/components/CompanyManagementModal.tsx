import React from 'react';
import FeatureModal from '../features/company-management/components/CompanyManagementModal';

// Thin wrapper to preserve existing import path while using the feature-scoped modal implementation.
export default function CompanyManagementModal(props: any) {
  return <FeatureModal {...props} />;
}
