import React from 'react';
import { useOutletContext } from 'react-router-dom';
import { useAppData } from '../contexts/AppDataContext';
import { DoseEvent } from '../../logic';
import OverviewView from '../views/OverviewView';

interface OutletContext {
    onEditEvent: (event: DoseEvent) => void;
    onOpenWeightModal: () => void;
}

const OverviewPage: React.FC = () => {
    const { onEditEvent, onOpenWeightModal } = useOutletContext<OutletContext>();
    const { events, weight, labResults, simulation, currentTime, simCI } = useAppData();

    return (
        <OverviewView
            events={events}
            weight={weight}
            labResults={labResults}
            simulation={simulation}
            currentTime={currentTime}
            simCI={simCI}
            onEditEvent={onEditEvent}
            onOpenWeightModal={onOpenWeightModal}
        />
    );
};

export default OverviewPage;
