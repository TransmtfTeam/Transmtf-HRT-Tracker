let logoutInProgress = false;

export const setLogoutInProgress = (value: boolean) => {
    logoutInProgress = value;
};

export const isLogoutInProgress = () => logoutInProgress;
