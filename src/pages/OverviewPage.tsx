import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { useAppData } from '../contexts/AppDataContext';
import { DoseEvent } from '../../logic';
import OverviewView from '../views/OverviewView';

interface OutletContext {
    onAddEvent: () => void;
    onEditEvent: (event: DoseEvent) => void;
}

const OverviewPage: React.FC = () => {
    const { onAddEvent, onEditEvent } = useOutletContext<OutletContext>();
    const { events, labResults, simulation, currentTime, simCI, baselineE2PGmL } = useAppData();

    return (
        <OverviewView
            events={events}
            labResults={labResults}
            simulation={simulation}
            currentTime={currentTime}
            simCI={simCI}
            baselineE2PGmL={baselineE2PGmL}
            onAddEvent={onAddEvent}
            onEditEvent={onEditEvent}
        />
    );
};

export default OverviewPage;
