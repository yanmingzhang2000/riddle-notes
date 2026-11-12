import React, { useState, useEffect } from 'react';
import { AlertTriangle, Download, X, Clock } from 'lucide-react';
import { UpdateBannerData, MandatoryUpdateData } from '../../shared/update-types';

interface UpdateBannerProps {
  bannerData?: UpdateBannerData;
  mandatoryUpdateData?: MandatoryUpdateData;
  onRemindLater?: (version: string) => void;
  onDismiss?: (version: string) => void;
  onDownload?: (url: string) => void;
}

export const UpdateBanner: React.FC<UpdateBannerProps> = ({
  bannerData,
  mandatoryUpdateData,
  onRemindLater,
  onDismiss,
  onDownload,
}) => {
  const [isVisible, setIsVisible] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    setIsVisible(!!(bannerData || mandatoryUpdateData));
  }, [bannerData, mandatoryUpdateData]);

  if (!isVisible || (!bannerData && !mandatoryUpdateData)) {
    return null;
  }

  // 处理强制更新
  if (mandatoryUpdateData) {
    return (
      <div className="bg-amber-50 border-l-4 border-amber-400 p-4 mb-4 shadow-sm">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <AlertTriangle className="h-5 w-5 text-amber-600" aria-hidden="true" />
          </div>
          <div className="ml-3 flex-1">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-amber-800">
                {mandatoryUpdateData.title}
              </h3>
              <button
                type="button"
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="ml-3 text-amber-600 hover:text-amber-800 focus:outline-none"
              >
                <span className="sr-only">
                  {isCollapsed ? '展开' : '折叠'}
                </span>
                {isCollapsed ? '↓' : '↑'}
              </button>
            </div>
            
            {!isCollapsed && (
              <>
                <div className="mt-2 text-sm text-amber-700">
                  <p className="mb-2">{mandatoryUpdateData.message}</p>
                  <div className="bg-amber-100 p-3 rounded text-sm">
                    <div className="grid grid-cols-2 gap-2 mb-2">
                      <div>
                        <span className="font-medium">当前版本：</span>
                        <span className="text-amber-800">{mandatoryUpdateData.currentVersion}</span>
                      </div>
                      <div>
                        <span className="font-medium">最新版本：</span>
                        <span className="text-green-600">{mandatoryUpdateData.latestVersion}</span>
                      </div>
                    </div>
                    <p>
                      <span className="font-medium">最低支持版本：</span>
                      <span className="text-red-600">{mandatoryUpdateData.minSupportedVersion}</span>
                    </p>
                  </div>
                </div>
                
                <div className="mt-4">
                  <button
                    type="button"
                    onClick={() => onDownload?.(mandatoryUpdateData.downloadUrl)}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-amber-600 hover:bg-amber-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-amber-500"
                  >
                    <Download className="-ml-1 mr-2 h-4 w-4" aria-hidden="true" />
                    下载新版本
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 处理普通更新提醒
  if (bannerData) {
    return (
      <div className="bg-blue-50 border-l-4 border-blue-400 p-4 mb-4 shadow-sm rounded-r">
        <div className="flex items-start">
          <div className="flex-shrink-0">
            <Download className="h-5 w-5 text-blue-500" aria-hidden="true" />
          </div>
          <div className="ml-3 flex-1">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-blue-800">
                {bannerData.title}
              </h3>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => setIsCollapsed(!isCollapsed)}
                  className="text-blue-600 hover:text-blue-800 focus:outline-none"
                >
                  <span className="sr-only">
                    {isCollapsed ? '展开' : '折叠'}
                  </span>
                  {isCollapsed ? '↓' : '↑'}
                </button>
                {bannerData.showDismiss && (
                  <button
                    type="button"
                    onClick={() => {
                      onDismiss?.(bannerData.version);
                      setIsVisible(false);
                    }}
                    className="text-blue-600 hover:text-blue-800 focus:outline-none"
                  >
                    <span className="sr-only">忽略</span>
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>
            </div>
            
            {!isCollapsed && (
              <>
                <div className="mt-2 text-sm text-blue-700">
                  <p className="mb-3">{bannerData.message}</p>
                  
                  <div className="bg-blue-100 p-3 rounded mb-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium">版本 {bannerData.version}</span>
                      <span className="text-xs text-blue-600">
                        发布于 {new Date(bannerData.publishedAt).toLocaleDateString('zh-CN')}
                      </span>
                    </div>
                    <p className="text-sm">{bannerData.releaseNotes}</p>
                  </div>
                </div>
                
                <div className="mt-4 flex items-center space-x-3">
                  <button
                    type="button"
                    onClick={() => onDownload?.(bannerData.downloadUrl)}
                    className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                  >
                    <Download className="-ml-1 mr-2 h-4 w-4" aria-hidden="true" />
                    下载新版本
                  </button>
                  
                  {bannerData.showRemindLater && (
                    <button
                      type="button"
                      onClick={() => {
                        onRemindLater?.(bannerData.version);
                        setIsVisible(false);
                      }}
                      className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                    >
                      <Clock className="-ml-0.5 mr-2 h-4 w-4" aria-hidden="true" />
                      稍后提醒
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  return null;
};