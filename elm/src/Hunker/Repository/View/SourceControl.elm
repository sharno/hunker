module Hunker.Repository.View.SourceControl exposing (Config, view)

import Html exposing (Html, button, label, option, section, select, span, text)
import Html.Attributes exposing (attribute, class, disabled, selected, type_, value)
import Html.Events exposing (onClick, onInput)
import Hunker.ApiError as ApiError
import Hunker.Domain.Git as Git exposing (BranchName)
import Hunker.Domain.Repository as Repository exposing (BranchPresence(..), Checkout(..))
import Hunker.Repository.SourceControl as SourceControl exposing (Activity(..), Operation(..), Outcome(..))


type alias Config msg =
    { state : SourceControl.State
    , selectedBranch : BranchName -> msg
    , requestedRefresh : msg
    , requestedPull : msg
    }


view : Config msg -> Html msg
view config =
    case config.state of
        SourceControl.Unavailable _ error ->
            section [ class "repository-source-control" ]
                [ span [ class "source-control-feedback is-error", attribute "role" "alert" ] [ text (ApiError.message error) ]
                , button [ type_ "button", onClick config.requestedRefresh ] [ text "Retry" ]
                ]

        SourceControl.Ready source ->
            readyView config source


type Sync
    = NoUpstream
    | InSync
    | Ahead Int
    | Behind Int
    | Diverged Int Int


sync : Checkout -> Sync
sync checkout =
    case checkout of
        TrackingBranch tracking ->
            case ( tracking.ahead, tracking.behind ) of
                ( 0, 0 ) ->
                    InSync

                ( ahead, 0 ) ->
                    Ahead ahead

                ( 0, behind ) ->
                    Behind behind

                ( ahead, behind ) ->
                    Diverged ahead behind

        UntrackedBranch _ ->
            NoUpstream

        DetachedHead _ ->
            NoUpstream


readyView : Config msg -> SourceControl.Snapshot -> Html msg
readyView config source =
    let
        status =
            source.status

        current =
            Repository.checkoutBranch status.checkout

        busy =
            SourceControl.busy source.activity

        ( ahead, behind ) =
            case sync status.checkout of
                Ahead count ->
                    ( count, 0 )

                Behind count ->
                    ( 0, count )

                Diverged aheadCount behindCount ->
                    ( aheadCount, behindCount )

                InSync ->
                    ( 0, 0 )

                NoUpstream ->
                    ( 0, 0 )
    in
    section [ class "repository-source-control" ]
        [ label [ class "source-control-branch" ]
            [ span [] [ text "Branch" ]
            , select
                [ value (current |> Maybe.map Git.branchToString |> Maybe.withDefault "")
                , disabled busy
                , attribute "aria-label" "Checked-out repository branch"
                , onInput (Git.branchName >> config.selectedBranch)
                ]
                ((case status.checkout of
                    DetachedHead checkout ->
                        [ option [ value "" ] [ text ("Detached at " ++ String.left 7 (Git.oidToString checkout.oid)) ] ]

                    TrackingBranch _ ->
                        []

                    UntrackedBranch _ ->
                        []
                 )
                    ++ List.map
                        (\candidate ->
                            option [ value (Git.branchToString candidate.name), selected (Just candidate.name == current) ]
                                [ text
                                    (Git.branchToString candidate.name
                                        ++ (case candidate.presence of
                                                RemoteBranch ->
                                                    " · remote"

                                                LocalBranch ->
                                                    ""

                                                LocalAndRemoteBranch ->
                                                    ""
                                           )
                                    )
                                ]
                        )
                        status.branches
                )
            ]
        , if ahead > 0 then
            span [ class "source-control-count is-ahead" ] [ text (String.fromInt ahead ++ " ↑") ]

          else
            text ""
        , if behind > 0 then
            span [ class "source-control-count is-behind" ] [ text (String.fromInt behind ++ " ↓") ]

          else
            text ""
        , span [ class "source-control-changes" ]
            [ text
                (String.fromInt status.staged
                    ++ " staged · "
                    ++ String.fromInt status.unstaged
                    ++ " changed · "
                    ++ String.fromInt status.untracked
                    ++ " untracked"
                )
            ]
        , feedback source.activity status.path
        , button
            [ type_ "button", class "source-control-refresh", disabled busy, attribute "aria-label" "Refresh repository source control", onClick config.requestedRefresh ]
            [ text "↻" ]
        , button [ type_ "button", class "source-control-pull", disabled (busy || not (SourceControl.canPull status)), onClick config.requestedPull ]
            [ text
                (case source.activity of
                    PullInFlight ->
                        "Pulling…"

                    PullSynchronizing count ->
                        SourceControl.pulledMessage count ++ " Refreshing status…"

                    Idle ->
                        pullLabel behind

                    Refreshing ->
                        pullLabel behind

                    BranchSwitching _ ->
                        pullLabel behind

                    Succeeded _ ->
                        pullLabel behind

                    Failed _ _ ->
                        pullLabel behind
                )
            ]
        ]


pullLabel : Int -> String
pullLabel behind =
    if behind > 0 then
        "Pull " ++ String.fromInt behind ++ " ↓"

    else
        "Up to date"


feedback : Activity -> String -> Html msg
feedback activity path =
    let
        pathLabel =
            span [ class "source-control-path" ] [ text path ]
    in
    case activity of
        Succeeded outcome ->
            span [ class "source-control-feedback is-success" ]
                [ text
                    (case outcome of
                        Refreshed ->
                            "Repository refreshed."

                        Switched branch ->
                            "Switched to " ++ Git.branchToString branch ++ "."

                        Pulled count ->
                            SourceControl.pulledMessage count
                    )
                ]

        Failed operation error ->
            span [ class "source-control-feedback is-error", attribute "role" "alert" ]
                [ text
                    ((case operation of
                        RefreshOperation ->
                            "Refresh failed: "

                        SwitchOperation branch ->
                            "Could not switch to " ++ Git.branchToString branch ++ ": "

                        PullOperation ->
                            "Pull failed: "
                     )
                        ++ ApiError.message error
                    )
                ]

        Idle ->
            pathLabel

        Refreshing ->
            pathLabel

        BranchSwitching _ ->
            pathLabel

        PullInFlight ->
            pathLabel

        PullSynchronizing _ ->
            pathLabel
